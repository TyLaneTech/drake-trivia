"""Player-facing JSON API."""

from flask import Blueprint, jsonify, session
from sqlalchemy import select

from . import db
from .game import compute_awards, game_snapshot, get_active_game, leaderboard_for
from .models import Game, Question, Round


api_bp = Blueprint('api', __name__)


@api_bp.get('/api/state')
def state():
    """Bootstrap state for any client (player or scoreboard)."""
    game = get_active_game()
    if game is None:
        return jsonify({'game': None})
    payload = game_snapshot(game, include_correct=False)
    payload['me'] = {
        'team_id': session.get('team_id'),
        'team_name': session.get('team_name'),
        'team_color': session.get('team_color'),
        'team_emoji': session.get('team_emoji'),
    }
    return jsonify(payload)


@api_bp.get('/api/categories')
def categories():
    """Distinct question categories + their counts. Public — solo-mode setup
    populates its dropdown from here."""
    rows = db.session.execute(
        select(Question.category, db.func.count(Question.id))
        .group_by(Question.category)
        .order_by(Question.category.asc())
    ).all()
    return jsonify([{'category': c, 'count': n} for c, n in rows])


@api_bp.get('/api/games/recent')
def recent_games():
    """Most recent ended games, newest first — for the recap picker."""
    rows = db.session.scalars(
        select(Game)
        .where(Game.state == 'ended')
        .order_by(Game.id.desc())
        .limit(20)
    ).all()
    return jsonify([
        {
            'id': g.id,
            'name': g.name,
            'category_filter': g.category_filter,
            'auto_host': bool(g.auto_host),
            'target_question_count': g.target_question_count,
            'started_at': g.started_at.isoformat() + 'Z' if g.started_at else None,
            'ended_at': g.ended_at.isoformat() + 'Z' if g.ended_at else None,
        }
        for g in rows
    ])


@api_bp.get('/api/games/<int:game_id>/recap')
def game_recap(game_id):
    """Full post-game data: standings, awards, and per-round breakdown.

    Restricted to ended games — exposing correct answers for an in-progress
    round would defeat the point of asking it.
    """
    game = db.session.get(Game, game_id)
    if game is None:
        return jsonify({'error': 'Game not found'}), 404
    if game.state != 'ended':
        return jsonify({'error': 'Game is still in progress'}), 403

    rounds = db.session.scalars(
        select(Round).where(Round.game_id == game.id).order_by(Round.sequence)
    ).all()
    rounds_data = []
    for r in rounds:
        q = r.question
        rounds_data.append({
            'sequence': r.sequence,
            'phase': r.phase,
            'shown_at': r.shown_at.isoformat() + 'Z' if r.shown_at else None,
            'question': {
                'id': q.id,
                'type': q.type,
                'text': q.text,
                'options': q.options,
                'correct_answer': q.correct_answer,
                'category': q.category,
                'difficulty': q.difficulty,
                'points': q.points,
                'time_limit_s': q.time_limit_s,
                'explanation': q.explanation,
            },
            'answers': [
                {
                    'team_id': a.team_id,
                    'team_name': a.team.name,
                    'team_color': a.team.color,
                    'team_emoji': a.team.emoji,
                    'answer_text': a.answer_text,
                    'is_correct': a.is_correct,
                    'is_first_correct': a.is_first_correct,
                    'response_time_ms': a.response_time_ms,
                    'points_awarded': a.points_awarded,
                }
                for a in sorted(r.answers, key=lambda x: (not x.is_correct, x.response_time_ms))
            ],
        })

    return jsonify({
        'game': {
            'id': game.id,
            'name': game.name,
            'state': game.state,
            'category_filter': game.category_filter,
            'auto_host': bool(game.auto_host),
            'target_question_count': game.target_question_count,
            'started_at': game.started_at.isoformat() + 'Z' if game.started_at else None,
            'ended_at': game.ended_at.isoformat() + 'Z' if game.ended_at else None,
        },
        'me': {'team_id': session.get('team_id')},
        'leaderboard': leaderboard_for(game),
        'awards': compute_awards(game),
        'rounds': rounds_data,
    })
