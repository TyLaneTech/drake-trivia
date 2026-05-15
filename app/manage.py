"""Open question-bank management API.

Designed for headless callers (CLI, scripts, Claude in agent mode) that need to
read and mutate the question bank without going through the admin browser flow.

Auth: optional shared-secret header. If the `MANAGE_API_TOKEN` env var is set,
every request must send `X-Manage-Token: <token>` (or `?token=<token>`). If
the env var is unset, the API is fully open — intentional for local/dev use.

All endpoints live under `/api/manage/`. See `CLAUDE.md` for the full reference
and example invocations.
"""

from __future__ import annotations

import os
from functools import wraps

from flask import Blueprint, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from . import db
from .admin import _apply_question_payload, _question_from_payload
from .models import Question, Round


manage_bp = Blueprint('manage', __name__)


VALID_TYPES = ('multiple_choice', 'true_false', 'free_text')
VALID_DIFFICULTIES = ('easy', 'medium', 'hard')


def token_required(fn):
    """Gate the request behind a shared secret if `MANAGE_API_TOKEN` is set.

    Token may be supplied via the `X-Manage-Token` header or the `token`
    query string. When the env var is unset (default), the endpoint is open.
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        expected = os.getenv('MANAGE_API_TOKEN')
        if expected:
            provided = request.headers.get('X-Manage-Token') or request.args.get('token')
            if provided != expected:
                return jsonify({'error': 'Invalid or missing X-Manage-Token'}), 401
        return fn(*args, **kwargs)
    return wrapper


def _question_query(args):
    """Build a Question select from query-string filters.

    Recognised: category, difficulty, type, q (substring search across text and
    correct_answer), ids (comma-separated).
    """
    q = select(Question)
    if args.get('category'):
        q = q.where(Question.category == args['category'])
    if args.get('difficulty'):
        q = q.where(Question.difficulty == args['difficulty'].lower())
    if args.get('type'):
        q = q.where(Question.type == args['type'])
    text_term = args.get('q', '').strip()
    if text_term:
        like = f'%{text_term}%'
        q = q.where(Question.text.ilike(like) | Question.correct_answer.ilike(like))
    ids_csv = args.get('ids', '').strip()
    if ids_csv:
        try:
            ids = [int(x) for x in ids_csv.split(',') if x.strip()]
            q = q.where(Question.id.in_(ids))
        except ValueError:
            pass
    return q


def _referenced_count(question_id: int) -> int:
    return db.session.scalar(
        select(db.func.count(Round.id)).where(Round.question_id == question_id)
    ) or 0


# ---------- Questions ----------

@manage_bp.get('/api/manage/questions')
@token_required
def list_questions():
    """List questions, optionally filtered.

    Query params:
      category    exact category match
      difficulty  easy|medium|hard
      type        multiple_choice|true_false|free_text
      q           substring search (text + correct_answer, case-insensitive)
      ids         comma-separated id whitelist
      limit       int (default unbounded)
      offset      int (default 0)
      format      'ids' to return only id list, 'compact' to drop options/explanation
    """
    q = _question_query(request.args).order_by(Question.id.desc())
    try:
        offset = max(0, int(request.args.get('offset', 0)))
    except ValueError:
        offset = 0
    try:
        limit_raw = request.args.get('limit')
        limit = int(limit_raw) if limit_raw else None
    except ValueError:
        limit = None
    if offset:
        q = q.offset(offset)
    if limit:
        q = q.limit(limit)
    rows = db.session.scalars(q).all()
    fmt = request.args.get('format', '').strip()
    if fmt == 'ids':
        return jsonify([r.id for r in rows])
    if fmt == 'compact':
        return jsonify([
            {
                'id': r.id,
                'category': r.category,
                'difficulty': r.difficulty,
                'type': r.type,
                'text': r.text,
                'correct_answer': r.correct_answer,
                'points': r.points,
            }
            for r in rows
        ])
    return jsonify([r.to_admin_dict() for r in rows])


@manage_bp.get('/api/manage/questions/<int:qid>')
@token_required
def get_question(qid):
    q = db.session.get(Question, qid)
    if q is None:
        return jsonify({'error': 'not found'}), 404
    payload = q.to_admin_dict()
    payload['referenced_rounds'] = _referenced_count(qid)
    return jsonify(payload)


@manage_bp.post('/api/manage/questions')
@token_required
def create_question():
    data = request.get_json(silent=True) or {}
    try:
        q = _question_from_payload(data)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    db.session.add(q)
    db.session.commit()
    return jsonify(q.to_admin_dict()), 201


@manage_bp.route('/api/manage/questions/<int:qid>', methods=['PUT', 'PATCH'])
@token_required
def update_question(qid):
    """Update a question.

    PUT replaces the entire question (all fields required).
    PATCH merges with the existing question (only provided fields change).
    """
    q = db.session.get(Question, qid)
    if q is None:
        return jsonify({'error': 'not found'}), 404
    data = request.get_json(silent=True) or {}
    if request.method == 'PATCH':
        merged = q.to_admin_dict()
        merged.update(data)
        data = merged
    try:
        _apply_question_payload(q, data)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    db.session.commit()
    return jsonify(q.to_admin_dict())


@manage_bp.delete('/api/manage/questions/<int:qid>')
@token_required
def delete_question(qid):
    q = db.session.get(Question, qid)
    if q is None:
        return jsonify({'error': 'not found'}), 404
    refs = _referenced_count(qid)
    if refs:
        return jsonify({
            'error': 'Cannot delete a question referenced by existing rounds — '
                     'it would break past game recaps',
            'referenced_rounds': refs,
        }), 409
    db.session.delete(q)
    try:
        db.session.commit()
    except IntegrityError as e:
        db.session.rollback()
        return jsonify({'error': f'Integrity error: {e.orig}'}), 409
    return jsonify({'ok': True, 'deleted_id': qid})


@manage_bp.post('/api/manage/questions/bulk')
@token_required
def bulk_create_questions():
    """Bulk create. Body: {"questions": [...]} or a raw JSON array.

    Returns the created ids and any per-item validation errors (by index).
    """
    data = request.get_json(silent=True) or {}
    items = data.get('questions') if isinstance(data, dict) else data
    if not isinstance(items, list):
        return jsonify({'error': 'Expected an array of questions (or {"questions": [...]})'}), 400
    created_ids: list[int] = []
    errors: list[dict] = []
    for i, item in enumerate(items):
        try:
            q = _question_from_payload(item)
            db.session.add(q)
            db.session.flush()  # populate q.id without committing
            created_ids.append(q.id)
        except ValueError as e:
            errors.append({'index': i, 'error': str(e), 'item': item})
    if errors:
        # Rollback the whole batch on any error — all-or-nothing keeps the bank
        # consistent. Caller can re-submit with the bad items fixed/removed.
        db.session.rollback()
        return jsonify({
            'error': 'Some items failed validation — no questions were created',
            'errors': errors,
            'attempted': len(items),
        }), 400
    db.session.commit()
    return jsonify({'ok': True, 'created': len(created_ids), 'ids': created_ids}), 201


@manage_bp.post('/api/manage/questions/bulk_delete')
@token_required
def bulk_delete_questions():
    """Delete many questions at once. Body accepts either:
      {"ids": [1, 2, 3]}  — explicit list
      {"category": "X", "difficulty": "hard", "type": "..."}  — filter
      {"all": true}  — delete every unreferenced question (DESTRUCTIVE — use with care)

    Filter mode requires at least one filter unless `all: true`.
    Refuses to delete questions referenced by existing rounds; returns those
    ids under `skipped_referenced`.
    """
    data = request.get_json(silent=True) or {}
    q = select(Question)
    if isinstance(data.get('ids'), list) and data['ids']:
        try:
            ids = [int(x) for x in data['ids']]
        except (TypeError, ValueError):
            return jsonify({'error': 'ids must be integers'}), 400
        q = q.where(Question.id.in_(ids))
    elif data.get('all'):
        pass  # delete everything (still gated by referenced check)
    else:
        filters_applied = False
        if data.get('category'):
            q = q.where(Question.category == data['category'])
            filters_applied = True
        if data.get('difficulty'):
            q = q.where(Question.difficulty == str(data['difficulty']).lower())
            filters_applied = True
        if data.get('type'):
            q = q.where(Question.type == data['type'])
            filters_applied = True
        if not filters_applied:
            return jsonify({
                'error': 'Provide one of: ids, category, difficulty, type, or all=true',
            }), 400
    rows = db.session.scalars(q).all()
    referenced_ids = set(db.session.scalars(
        select(Round.question_id).where(Round.question_id.in_([r.id for r in rows]))
    ).all())
    deleted: list[int] = []
    skipped: list[int] = []
    for row in rows:
        if row.id in referenced_ids:
            skipped.append(row.id)
            continue
        db.session.delete(row)
        deleted.append(row.id)
    try:
        db.session.commit()
    except IntegrityError as e:
        db.session.rollback()
        return jsonify({'error': f'Integrity error: {e.orig}'}), 409
    return jsonify({
        'ok': True,
        'deleted': len(deleted),
        'deleted_ids': deleted,
        'skipped_referenced': skipped,
    })


# ---------- Categories ----------

@manage_bp.get('/api/manage/categories')
@token_required
def list_categories():
    """All categories with question counts."""
    rows = db.session.execute(
        select(Question.category, db.func.count(Question.id))
        .group_by(Question.category)
        .order_by(Question.category.asc())
    ).all()
    return jsonify([{'category': c, 'count': n} for c, n in rows])


@manage_bp.post('/api/manage/categories/rename')
@token_required
def rename_category():
    """Rename a category across every question. Body: {from, to}."""
    data = request.get_json(silent=True) or {}
    src = (data.get('from') or '').strip()
    dst = (data.get('to') or '').strip()
    if not src or not dst:
        return jsonify({'error': 'Both "from" and "to" are required'}), 400
    if src == dst:
        return jsonify({'ok': True, 'updated': 0, 'note': 'Names are identical'})
    affected = db.session.execute(
        db.update(Question)
        .where(Question.category == src)
        .values(category=dst[:64])
    ).rowcount
    db.session.commit()
    return jsonify({'ok': True, 'updated': affected, 'from': src, 'to': dst[:64]})


@manage_bp.delete('/api/manage/categories/<path:name>')
@token_required
def delete_category(name):
    """Delete every (unreferenced) question in a category.

    Use ?force=true to also delete questions tied to past game rounds. Without
    force, those are kept and returned in `skipped_referenced`.
    """
    rows = db.session.scalars(select(Question).where(Question.category == name)).all()
    if not rows:
        return jsonify({'error': f'No questions in category "{name}"'}), 404
    force = request.args.get('force', '').lower() in ('1', 'true', 'yes')
    referenced_ids = set(db.session.scalars(
        select(Round.question_id).where(Round.question_id.in_([r.id for r in rows]))
    ).all())
    deleted: list[int] = []
    skipped: list[int] = []
    for row in rows:
        if row.id in referenced_ids and not force:
            skipped.append(row.id)
            continue
        db.session.delete(row)
        deleted.append(row.id)
    try:
        db.session.commit()
    except IntegrityError as e:
        db.session.rollback()
        return jsonify({'error': f'Integrity error: {e.orig}'}), 409
    return jsonify({
        'ok': True,
        'category': name,
        'deleted': len(deleted),
        'deleted_ids': deleted,
        'skipped_referenced': skipped,
    })


# ---------- Overview + schema ----------

@manage_bp.get('/api/manage/stats')
@token_required
def stats():
    """Snapshot of the question bank for quick orientation."""
    total = db.session.scalar(select(db.func.count(Question.id))) or 0
    by_cat = db.session.execute(
        select(Question.category, db.func.count(Question.id))
        .group_by(Question.category)
        .order_by(db.func.count(Question.id).desc())
    ).all()
    by_diff = db.session.execute(
        select(Question.difficulty, db.func.count(Question.id))
        .group_by(Question.difficulty)
    ).all()
    by_type = db.session.execute(
        select(Question.type, db.func.count(Question.id))
        .group_by(Question.type)
    ).all()
    referenced = db.session.scalar(
        select(db.func.count(db.func.distinct(Round.question_id)))
    ) or 0
    return jsonify({
        'total_questions': total,
        'referenced_in_rounds': referenced,
        'by_category': [{'category': c, 'count': n} for c, n in by_cat],
        'by_difficulty': [{'difficulty': d, 'count': n} for d, n in by_diff],
        'by_type': [{'type': t, 'count': n} for t, n in by_type],
    })


@manage_bp.get('/api/manage/schema')
@token_required
def schema():
    """Self-describing endpoint — payload shape + valid enum values.

    Lets a fresh caller (or LLM) discover what the API expects without
    reading the source. Mirrored in CLAUDE.md.
    """
    return jsonify({
        'question_payload': {
            'type': {
                'required': True,
                'enum': list(VALID_TYPES),
                'default': 'multiple_choice',
            },
            'text': {'required': True, 'description': 'The question itself.'},
            'correct_answer': {
                'required': True,
                'description': (
                    "Must be one of `options` for multiple_choice. Must be "
                    "'True' or 'False' for true_false. For free_text, pipe-"
                    "separate alternates: 'Hannibal|Hannibal Barca'."
                ),
            },
            'options': {
                'required_for': ['multiple_choice'],
                'description': 'List of >=2 strings. Ignored for true_false/free_text.',
            },
            'category': {'required': False, 'default': 'General', 'max_len': 64},
            'difficulty': {
                'required': False,
                'enum': list(VALID_DIFFICULTIES),
                'default': 'medium',
            },
            'points': {'required': False, 'default': 5, 'min': 1},
            'time_limit_s': {'required': False, 'default': 30, 'min': 5},
            'image_url': {'required': False, 'default': None},
            'explanation': {'required': False, 'default': None},
        },
        'endpoints': [
            {'method': 'GET', 'path': '/api/manage/questions',
             'desc': 'List questions. Filters: category, difficulty, type, q, ids, limit, offset, format.'},
            {'method': 'GET', 'path': '/api/manage/questions/<id>',
             'desc': 'Fetch one question (includes referenced_rounds count).'},
            {'method': 'POST', 'path': '/api/manage/questions',
             'desc': 'Create one question. Body: question payload.'},
            {'method': 'PUT', 'path': '/api/manage/questions/<id>',
             'desc': 'Replace question (all fields required).'},
            {'method': 'PATCH', 'path': '/api/manage/questions/<id>',
             'desc': 'Partial update — merges with existing.'},
            {'method': 'DELETE', 'path': '/api/manage/questions/<id>',
             'desc': 'Delete. Refuses if referenced by past rounds.'},
            {'method': 'POST', 'path': '/api/manage/questions/bulk',
             'desc': 'Bulk create. Body: {"questions": [...]}. All-or-nothing.'},
            {'method': 'POST', 'path': '/api/manage/questions/bulk_delete',
             'desc': 'Delete by ids, by filter, or all=true. Skips referenced.'},
            {'method': 'GET', 'path': '/api/manage/categories',
             'desc': 'Categories with counts.'},
            {'method': 'POST', 'path': '/api/manage/categories/rename',
             'desc': 'Rename a category. Body: {from, to}.'},
            {'method': 'DELETE', 'path': '/api/manage/categories/<name>',
             'desc': 'Delete all questions in a category. ?force=true ignores reference guard.'},
            {'method': 'GET', 'path': '/api/manage/stats',
             'desc': 'Overview: totals by category/difficulty/type.'},
            {'method': 'GET', 'path': '/api/manage/schema',
             'desc': 'This document — payload shape + endpoint list.'},
        ],
        'auth': (
            "If env var MANAGE_API_TOKEN is set, every request must send "
            "header 'X-Manage-Token: <token>' or query ?token=<token>. "
            "Unset = fully open."
        ),
    })
