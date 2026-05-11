"""Player-facing JSON API."""

from flask import Blueprint, jsonify, session

from .game import game_snapshot, get_active_game


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
