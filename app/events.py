"""SocketIO event handlers — the real-time fabric."""

from __future__ import annotations

import logging

from flask import current_app, request, session
from flask_socketio import emit, join_room

from . import db, socketio
from .game import (
    answer_count,
    broadcast_answer_count,
    broadcast_state,
    game_snapshot,
    get_active_game,
    lock_round,
    mark_ready,
    submit_answer,
    total_teams_in_game,
)
from .models import Round, Team


log = logging.getLogger(__name__)


@socketio.on('connect')
def on_connect():
    join_room('all')
    game = get_active_game()
    if game is None:
        emit('state', {'game': None})
        return
    snapshot = game_snapshot(game, include_correct=False)
    snapshot['me'] = {
        'team_id': session.get('team_id'),
        'team_name': session.get('team_name'),
        'team_color': session.get('team_color'),
        'team_emoji': session.get('team_emoji'),
        'is_admin': bool(session.get('is_admin')),
    }
    emit('state', snapshot)


@socketio.on('disconnect')
def on_disconnect():
    log.info("socket disconnected: %s", request.sid)


@socketio.on('submit_answer')
def on_submit_answer(data):
    if not session.get('team_id'):
        emit('error', {'message': 'Not signed in as a team'})
        return
    text = (data or {}).get('answer', '')
    round_id = (data or {}).get('round_id')
    game = get_active_game()
    if game is None or not game.current_round_id:
        emit('error', {'message': 'No active round'})
        return
    r = db.session.get(Round, game.current_round_id)
    if r is None or (round_id and int(round_id) != r.id):
        emit('error', {'message': 'Round mismatch'})
        return
    team = db.session.get(Team, session['team_id'])
    if team is None:
        emit('error', {'message': 'Team not found'})
        return
    try:
        a = submit_answer(game, r, team, str(text))
    except PermissionError as e:
        emit('error', {'message': str(e)})
        return
    emit('answer_accepted', {
        'round_id': r.id,
        'answer_text': a.answer_text,
        'response_time_ms': a.response_time_ms,
    })
    broadcast_answer_count(r)
    # Auto-host: if every team has now answered, lock + reveal immediately
    # — we'd just be showing a gratuitous "Pencils down" pause otherwise.
    if game.auto_host and r.phase == 'asking':
        total = total_teams_in_game(game)
        if total > 0 and answer_count(r) >= total:
            lock_round(r, app=current_app._get_current_object(), immediate_reveal=True)


@socketio.on('team_ready')
def on_team_ready(data):
    if not session.get('team_id'):
        emit('error', {'message': 'Not signed in as a team'})
        return
    game = get_active_game()
    if game is None or not game.current_round_id:
        emit('error', {'message': 'No active round'})
        return
    team = db.session.get(Team, session['team_id'])
    if team is None:
        emit('error', {'message': 'Team not found'})
        return
    # Capture the round the player is acknowledging *before* mark_ready
    # advances the game — otherwise the client would set myReadyRoundId to the
    # NEW round's id and skip the Ready button on the next reveal.
    round_id_at_click = game.current_round_id
    mark_ready(game, team, current_app._get_current_object())
    emit('ready_accepted', {'round_id': round_id_at_click})
