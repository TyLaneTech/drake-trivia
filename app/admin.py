"""Admin dashboard + management API."""

from __future__ import annotations

import json
from functools import wraps

from flask import Blueprint, current_app, jsonify, redirect, render_template, request, session, url_for
from sqlalchemy import select

from . import db
from .game import (
    broadcast_state,
    end_game,
    get_active_game,
    get_or_create_active_game,
    leaderboard_for,
    lock_round,
    reveal_round,
    round_snapshot,
    start_round,
)
from .models import Answer, Game, GameParticipant, Question, Round, Team


admin_bp = Blueprint('admin', __name__)


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get('is_admin'):
            if request.path.startswith('/api/'):
                return jsonify({'error': 'admin required'}), 401
            return redirect(url_for('auth.admin_login'))
        return fn(*args, **kwargs)
    return wrapper


@admin_bp.get('/admin')
@admin_required
def dashboard():
    return render_template('admin.html')


# ---------- Question bank ----------

@admin_bp.get('/api/admin/questions')
@admin_required
def list_questions():
    qs = db.session.scalars(select(Question).order_by(Question.id.desc())).all()
    return jsonify([q.to_admin_dict() for q in qs])


@admin_bp.post('/api/admin/questions')
@admin_required
def create_question():
    data = request.get_json(silent=True) or {}
    try:
        q = _question_from_payload(data)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    db.session.add(q)
    db.session.commit()
    return jsonify(q.to_admin_dict()), 201


@admin_bp.put('/api/admin/questions/<int:qid>')
@admin_required
def update_question(qid):
    q = db.session.get(Question, qid)
    if q is None:
        return jsonify({'error': 'not found'}), 404
    data = request.get_json(silent=True) or {}
    try:
        _apply_question_payload(q, data)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    db.session.commit()
    return jsonify(q.to_admin_dict())


@admin_bp.delete('/api/admin/questions/<int:qid>')
@admin_required
def delete_question(qid):
    q = db.session.get(Question, qid)
    if q is None:
        return jsonify({'error': 'not found'}), 404
    db.session.delete(q)
    db.session.commit()
    return jsonify({'ok': True})


@admin_bp.post('/api/admin/questions/import')
@admin_required
def import_questions():
    """Bulk import. Accepts {"questions": [...]} or a raw list."""
    data = request.get_json(silent=True) or {}
    items = data.get('questions') if isinstance(data, dict) else data
    if not isinstance(items, list):
        return jsonify({'error': 'Expected an array of questions'}), 400
    created = 0
    errors = []
    for i, item in enumerate(items):
        try:
            q = _question_from_payload(item)
            db.session.add(q)
            created += 1
        except ValueError as e:
            errors.append({'index': i, 'error': str(e)})
    db.session.commit()
    return jsonify({'created': created, 'errors': errors})


def _question_from_payload(data: dict) -> Question:
    q = Question()
    _apply_question_payload(q, data)
    return q


def _apply_question_payload(q: Question, data: dict) -> None:
    qtype = (data.get('type') or 'multiple_choice').strip()
    if qtype not in {'multiple_choice', 'true_false', 'free_text'}:
        raise ValueError("type must be multiple_choice|true_false|free_text")
    text = (data.get('text') or '').strip()
    if not text:
        raise ValueError("text is required")
    correct = (data.get('correct_answer') or '').strip()
    if not correct:
        raise ValueError("correct_answer is required")

    options = data.get('options') or []
    if qtype == 'multiple_choice':
        if not isinstance(options, list) or len(options) < 2:
            raise ValueError("multiple_choice needs at least 2 options")
        options = [str(o).strip() for o in options if str(o).strip()]
        if correct not in options:
            raise ValueError("correct_answer must be one of the options")
    elif qtype == 'true_false':
        options = ['True', 'False']
        if correct not in options:
            raise ValueError("true_false correct_answer must be True or False")
    else:
        options = []

    q.type = qtype
    q.text = text
    q.correct_answer = correct
    q.options = options
    q.category = (data.get('category') or 'General').strip()[:64] or 'General'
    q.difficulty = (data.get('difficulty') or 'medium').strip().lower()
    if q.difficulty not in {'easy', 'medium', 'hard'}:
        q.difficulty = 'medium'
    try:
        q.points = max(1, int(data.get('points') or 5))
    except (TypeError, ValueError):
        q.points = 5
    try:
        q.time_limit_s = max(5, int(data.get('time_limit_s') or 30))
    except (TypeError, ValueError):
        q.time_limit_s = 30
    q.image_url = (data.get('image_url') or None)
    q.explanation = (data.get('explanation') or None)


# ---------- Teams ----------

@admin_bp.get('/api/admin/teams')
@admin_required
def list_teams():
    teams = db.session.scalars(select(Team).order_by(Team.created_at.asc())).all()
    game = get_active_game()
    score_by_team: dict[int, int] = {}
    if game is not None:
        rows = db.session.execute(
            select(GameParticipant.team_id, GameParticipant.score)
            .where(GameParticipant.game_id == game.id)
        ).all()
        score_by_team = {tid: score for tid, score in rows}
    return jsonify([
        {**t.to_dict(), 'score': score_by_team.get(t.id, 0)}
        for t in teams
    ])


@admin_bp.delete('/api/admin/teams/<int:tid>')
@admin_required
def delete_team(tid):
    t = db.session.get(Team, tid)
    if t is None:
        return jsonify({'error': 'not found'}), 404
    # Remove dependent rows first (no DB-level cascade declared)
    db.session.execute(db.delete(Answer).where(Answer.team_id == tid))
    db.session.execute(db.delete(GameParticipant).where(GameParticipant.team_id == tid))
    db.session.delete(t)
    db.session.commit()
    game = get_active_game()
    if game is not None:
        broadcast_state(game)
    return jsonify({'ok': True})


# ---------- Game control ----------

@admin_bp.get('/api/admin/game')
@admin_required
def game_status():
    from .game import pending_ready_teams
    game = get_active_game()
    if game is None:
        return jsonify({'state': 'none'})
    payload = {
        'id': game.id,
        'name': game.name,
        'state': game.state,
        'phase': game.phase,
        'category_filter': game.category_filter,
        'auto_host': bool(game.auto_host),
        'target_question_count': game.target_question_count,
        'auto_reveal_delay_s': game.auto_reveal_delay_s,
        'auto_next_delay_s': game.auto_next_delay_s,
        'started_at': game.started_at.isoformat() + 'Z' if game.started_at else None,
        'leaderboard': leaderboard_for(game),
        'current_round': None,
        'rounds_played': db.session.scalar(
            select(db.func.count(Round.id)).where(Round.game_id == game.id)
        ) or 0,
        'pending_ready': pending_ready_teams(game),
    }
    if game.current_round_id:
        r = db.session.get(Round, game.current_round_id)
        if r:
            payload['current_round'] = round_snapshot(r, include_correct=True)
    return jsonify(payload)


@admin_bp.get('/api/admin/categories')
@admin_required
def list_categories():
    """Distinct categories from the question bank, with counts."""
    rows = db.session.execute(
        select(Question.category, db.func.count(Question.id))
        .group_by(Question.category)
        .order_by(Question.category.asc())
    ).all()
    return jsonify([{'category': c, 'count': n} for c, n in rows])


@admin_bp.post('/api/admin/game/new')
@admin_required
def new_game():
    """End any active game and create a fresh one in waiting."""
    data = request.get_json(silent=True) or {}
    existing = get_active_game()
    if existing is not None:
        existing.state = 'ended'
        existing.ended_at = db.func.now()
        db.session.commit()
    game = get_or_create_active_game(name=data.get('name') or 'Drake Trivia Night')
    game.phase = 'waiting'
    cat = (data.get('category_filter') or '').strip()
    game.category_filter = cat or None
    _apply_auto_host_payload(game, data)
    db.session.commit()
    broadcast_state(game)
    return jsonify({'ok': True, 'game_id': game.id, 'category_filter': game.category_filter})


@admin_bp.post('/api/admin/game/category')
@admin_required
def update_game_category():
    """Update the category filter on the active game without restarting it."""
    data = request.get_json(silent=True) or {}
    cat = (data.get('category_filter') or '').strip()
    game = get_active_game()
    if game is None:
        return jsonify({'error': 'No active game'}), 400
    game.category_filter = cat or None
    db.session.commit()
    return jsonify({'ok': True, 'category_filter': game.category_filter})


@admin_bp.post('/api/admin/game/auto_host')
@admin_required
def update_auto_host():
    """Update auto-host config on the active game without restarting it."""
    data = request.get_json(silent=True) or {}
    game = get_active_game()
    if game is None:
        return jsonify({'error': 'No active game'}), 400
    _apply_auto_host_payload(game, data)
    db.session.commit()
    broadcast_state(game)
    return jsonify({
        'ok': True,
        'auto_host': bool(game.auto_host),
        'target_question_count': game.target_question_count,
        'auto_reveal_delay_s': game.auto_reveal_delay_s,
        'auto_next_delay_s': game.auto_next_delay_s,
    })


def _apply_auto_host_payload(game: Game, data: dict) -> None:
    """Mutate `game` with auto-host fields from `data` if present.

    Sentinel `None` for `target_question_count` / `auto_next_delay_s` means
    'unlimited' / 'wait for every team', so a *missing* key leaves the value
    alone but an explicit null clears it.
    """
    if 'auto_host' in data:
        game.auto_host = bool(data.get('auto_host'))
    if 'target_question_count' in data:
        val = data.get('target_question_count')
        if val in (None, '', 0, '0'):
            game.target_question_count = None
        else:
            try:
                game.target_question_count = max(1, int(val))
            except (TypeError, ValueError):
                pass
    if 'auto_reveal_delay_s' in data:
        try:
            game.auto_reveal_delay_s = max(1, int(data.get('auto_reveal_delay_s')))
        except (TypeError, ValueError):
            pass
    if 'auto_next_delay_s' in data:
        val = data.get('auto_next_delay_s')
        if val in (None, '', 0, '0'):
            game.auto_next_delay_s = None
        else:
            try:
                game.auto_next_delay_s = max(1, int(val))
            except (TypeError, ValueError):
                pass


@admin_bp.post('/api/admin/game/start_round')
@admin_required
def start_round_route():
    data = request.get_json(silent=True) or {}
    qid = data.get('question_id')
    game = get_or_create_active_game()
    if not qid:
        # Auto-pick: random unused question, optionally filtered by the game's
        # category (or one passed in on this call as an override).
        used_ids = set(db.session.scalars(
            select(Round.question_id).where(Round.game_id == game.id)
        ).all())
        override_cat = (data.get('category') or '').strip()
        cat = override_cat or game.category_filter
        q_select = select(Question)
        if used_ids:
            q_select = q_select.where(~Question.id.in_(used_ids))
        if cat:
            q_select = q_select.where(Question.category == cat)
        # SQL random ordering: works on Postgres and SQLite alike.
        candidate = db.session.scalar(q_select.order_by(db.func.random()))
        if candidate is None:
            msg = ('No more questions in this category — pick another or add more'
                   if cat else 'All questions have been used — start a new game or add more')
            return jsonify({'error': msg}), 400
        qid = candidate.id
    try:
        r = start_round(game, int(qid), current_app._get_current_object())
    except (RuntimeError, ValueError) as e:
        return jsonify({'error': str(e)}), 400
    return jsonify({'ok': True, 'round_id': r.id})


@admin_bp.post('/api/admin/game/lock')
@admin_required
def lock_round_route():
    game = get_active_game()
    if game is None or not game.current_round_id:
        return jsonify({'error': 'No round in progress'}), 400
    r = db.session.get(Round, game.current_round_id)
    if r is None:
        return jsonify({'error': 'Round not found'}), 404
    lock_round(r, app=current_app._get_current_object())
    return jsonify({'ok': True})


@admin_bp.post('/api/admin/game/reveal')
@admin_required
def reveal_round_route():
    game = get_active_game()
    if game is None or not game.current_round_id:
        return jsonify({'error': 'No round to reveal'}), 400
    r = db.session.get(Round, game.current_round_id)
    if r is None:
        return jsonify({'error': 'Round not found'}), 404
    reveal_round(r, app=current_app._get_current_object())
    return jsonify({'ok': True})


@admin_bp.post('/api/admin/game/end')
@admin_required
def end_game_route():
    game = get_active_game()
    if game is None:
        return jsonify({'error': 'No active game'}), 400
    end_game(game)
    return jsonify({'ok': True})


@admin_bp.post('/api/admin/score/adjust')
@admin_required
def adjust_score():
    """Manual score override: {team_id, delta}"""
    data = request.get_json(silent=True) or {}
    team_id = data.get('team_id')
    delta = data.get('delta', 0)
    game = get_active_game()
    if game is None or not team_id:
        return jsonify({'error': 'No active game or team_id missing'}), 400
    gp = db.session.scalar(
        select(GameParticipant).where(
            GameParticipant.game_id == game.id,
            GameParticipant.team_id == int(team_id),
        )
    )
    if gp is None:
        return jsonify({'error': 'Team not in game'}), 404
    gp.score = max(0, gp.score + int(delta))
    db.session.commit()
    from .game import broadcast_leaderboard
    broadcast_leaderboard(game)
    return jsonify({'ok': True, 'new_score': gp.score})
