"""Game state machine + scoring + broadcast helpers.

Game/phase transitions:
    pending -> active(waiting) -> active(asking) -> active(locked) -> active(revealed)
                                   ^                                       |
                                   |---------------- next ------------------|
    active(*) -> ended(finale)
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

import eventlet
from sqlalchemy import select

from . import db, socketio
from .models import Answer, Game, GameParticipant, Question, Round, Team


# ---------- helpers ----------

def _norm(s: str) -> str:
    """Loose normalization for free-text comparison."""
    if s is None:
        return ''
    s = str(s).strip().lower()
    s = re.sub(r'[^a-z0-9 ]+', '', s)
    s = re.sub(r'\s+', ' ', s)
    # Drop leading "the "/"a "/"an "
    s = re.sub(r'^(the|a|an) ', '', s)
    return s


def is_correct_answer(question: Question, submitted: str) -> bool:
    if not submitted:
        return False
    if question.type == 'multiple_choice':
        # Submitted is an option string; compare normalized
        return _norm(submitted) == _norm(question.correct_answer)
    if question.type == 'true_false':
        return _norm(submitted) in {_norm(question.correct_answer)}
    # free_text — loose match against correct_answer (and any pipe-separated
    # alternates, e.g. "Mount Everest|Everest")
    candidates = [c for c in str(question.correct_answer).split('|')]
    target = _norm(submitted)
    return any(_norm(c) == target for c in candidates)


# ---------- game-state queries ----------

def get_active_game() -> Optional[Game]:
    return db.session.scalar(select(Game).where(Game.state == 'active').order_by(Game.id.desc()))


def get_or_create_active_game(name: str = 'Drake Trivia Night') -> Game:
    game = get_active_game()
    if game:
        return game
    game = Game(name=name, state='active', phase='waiting', started_at=datetime.utcnow())
    db.session.add(game)
    db.session.commit()
    return game


def ensure_participant(game: Game, team: Team) -> GameParticipant:
    gp = db.session.scalar(
        select(GameParticipant).where(
            GameParticipant.game_id == game.id,
            GameParticipant.team_id == team.id,
        )
    )
    if gp is None:
        gp = GameParticipant(game_id=game.id, team_id=team.id, score=0)
        db.session.add(gp)
        db.session.commit()
    return gp


def leaderboard_for(game: Game) -> list[dict]:
    rows = db.session.execute(
        select(GameParticipant, Team)
        .join(Team, Team.id == GameParticipant.team_id)
        .where(GameParticipant.game_id == game.id)
        .order_by(GameParticipant.score.desc(), Team.name.asc())
    ).all()
    out = []
    last_score = None
    rank = 0
    for i, (gp, team) in enumerate(rows, start=1):
        if gp.score != last_score:
            rank = i
            last_score = gp.score
        out.append({
            'rank': rank,
            'team_id': team.id,
            'team_name': team.name,
            'color': team.color,
            'emoji': team.emoji,
            'score': gp.score,
        })
    return out


def total_teams_in_game(game: Game) -> int:
    return db.session.scalar(
        select(db.func.count(GameParticipant.id)).where(GameParticipant.game_id == game.id)
    ) or 0


def answer_count(round_: Round) -> int:
    return db.session.scalar(
        select(db.func.count(Answer.id)).where(Answer.round_id == round_.id)
    ) or 0


def rounds_played(game: Game) -> int:
    return db.session.scalar(
        select(db.func.count(Round.id)).where(Round.game_id == game.id)
    ) or 0


def pending_ready_teams(game: Game) -> list[dict]:
    """Teams that haven't pressed Ready for the current round."""
    if not game.current_round_id:
        return []
    rows = db.session.execute(
        select(GameParticipant, Team)
        .join(Team, Team.id == GameParticipant.team_id)
        .where(
            GameParticipant.game_id == game.id,
            db.or_(
                GameParticipant.ready_round_id != game.current_round_id,
                GameParticipant.ready_round_id.is_(None),
            ),
        )
        .order_by(Team.name.asc())
    ).all()
    return [
        {
            'team_id': t.id,
            'team_name': t.name,
            'color': t.color,
            'emoji': t.emoji,
        }
        for _, t in rows
    ]


def all_teams_ready(game: Game) -> bool:
    if not game.current_round_id:
        return False
    total = total_teams_in_game(game)
    if total == 0:
        return False
    ready = db.session.scalar(
        select(db.func.count(GameParticipant.id)).where(
            GameParticipant.game_id == game.id,
            GameParticipant.ready_round_id == game.current_round_id,
        )
    ) or 0
    return ready >= total


# ---------- snapshots / broadcasts ----------

def game_snapshot(game: Game, *, include_correct: bool = False) -> dict:
    """Full state snapshot for clients connecting mid-game."""
    snapshot = {
        'game': {
            'id': game.id,
            'name': game.name,
            'state': game.state,
            'phase': game.phase,
            'auto_host': bool(game.auto_host),
            'target_question_count': game.target_question_count,
            'auto_reveal_delay_s': game.auto_reveal_delay_s,
            'auto_next_delay_s': game.auto_next_delay_s,
            'category_filter': game.category_filter,
            'rounds_played': rounds_played(game),
        },
        'round': None,
        'leaderboard': leaderboard_for(game),
        'total_teams': total_teams_in_game(game),
        'pending_ready': pending_ready_teams(game),
    }
    if game.current_round_id:
        r = db.session.get(Round, game.current_round_id)
        if r is not None:
            snapshot['round'] = round_snapshot(r, include_correct=include_correct)
    return snapshot


def round_snapshot(round_: Round, *, include_correct: bool = False) -> dict:
    q = round_.question
    # Datetimes are stored as naive UTC. Append 'Z' so the client parses them
    # as UTC instead of local time (which would offset the timer by the user's
    # timezone — that's what produced the "18020 seconds left" bug).
    _utc = lambda d: (d.isoformat() + 'Z') if d else None
    payload = {
        'round_id': round_.id,
        'sequence': round_.sequence,
        'phase': round_.phase,
        'shown_at': _utc(round_.shown_at),
        'locked_at': _utc(round_.locked_at),
        'revealed_at': _utc(round_.revealed_at),
        'time_limit_s': q.time_limit_s,
        'answer_count': answer_count(round_),
        'question': q.to_player_dict(),
    }
    if include_correct or round_.phase == 'revealed':
        payload['question']['correct_answer'] = q.correct_answer
        payload['question']['explanation'] = q.explanation
        payload['answers'] = [
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
            for a in sorted(round_.answers, key=lambda x: (not x.is_correct, x.response_time_ms))
        ]
    return payload


def broadcast_state(game: Game) -> None:
    """Push the player-safe state to everyone. Admin clients refresh via
    /api/admin/game to pick up correct answers."""
    socketio.emit('state', game_snapshot(game, include_correct=False))


def broadcast_leaderboard(game: Game) -> None:
    socketio.emit('leaderboard', {'leaderboard': leaderboard_for(game)})


def broadcast_answer_count(round_: Round) -> None:
    socketio.emit('answer_count', {
        'round_id': round_.id,
        'answer_count': answer_count(round_),
        'total_teams': total_teams_in_game(round_.game),
    })


def broadcast_ready(game: Game) -> None:
    socketio.emit('ready_update', {
        'round_id': game.current_round_id,
        'pending': pending_ready_teams(game),
        'total_teams': total_teams_in_game(game),
    })


# ---------- transitions ----------

def start_game(game: Game) -> None:
    game.state = 'active'
    game.phase = 'waiting'
    game.started_at = game.started_at or datetime.utcnow()
    db.session.commit()
    broadcast_state(game)


def end_game(game: Game) -> None:
    game.state = 'ended'
    game.phase = 'finale'
    game.ended_at = datetime.utcnow()
    db.session.commit()
    # Compute awards
    payload = {'leaderboard': leaderboard_for(game), 'awards': compute_awards(game)}
    socketio.emit('finale', payload)


def start_round(game: Game, question_id: int, app) -> Round:
    """Begin asking a question."""
    if game.phase == 'asking':
        raise RuntimeError("A question is already being asked")
    seq = (db.session.scalar(
        select(db.func.coalesce(db.func.max(Round.sequence), 0)).where(Round.game_id == game.id)
    ) or 0) + 1
    round_ = Round(
        game_id=game.id,
        question_id=question_id,
        sequence=seq,
        shown_at=datetime.utcnow(),
        phase='asking',
    )
    db.session.add(round_)
    db.session.flush()
    game.current_round_id = round_.id
    game.phase = 'asking'
    db.session.commit()

    # Broadcast question (player-safe; admins re-fetch via /api/admin/game)
    socketio.emit('question_start', round_snapshot(round_, include_correct=False))
    broadcast_state(game)

    # Auto-lock after time_limit_s
    schedule_auto_lock(app, round_.id, round_.question.time_limit_s)
    return round_


def lock_round(round_: Round, app=None, immediate_reveal: bool = False) -> None:
    """Move the round into the locked phase.

    If `immediate_reveal=True`, also runs scoring + reveal in the same call
    without emitting a separate `round_locked` event. Solo auto-host games
    auto-trigger this too — there's nothing a "Pencils down" pause would
    communicate when the only player just answered. Clients see asking →
    revealed in a single step.
    """
    if round_.phase != 'asking':
        return
    round_.phase = 'locked'
    round_.locked_at = datetime.utcnow()
    round_.game.phase = 'locked'
    game = round_.game
    db.session.commit()
    skip_locked = immediate_reveal or (game.auto_host and total_teams_in_game(game) <= 1)
    if skip_locked:
        reveal_round(round_, app=app)
        return
    socketio.emit('round_locked', {'round_id': round_.id})
    broadcast_state(game)
    # Auto-reveal once the host configured a delay
    if game.auto_host and app is not None:
        schedule_auto_action(app, game.id, 'reveal', game.auto_reveal_delay_s)


def reveal_round(round_: Round, app=None) -> None:
    if round_.phase not in {'asking', 'locked'}:
        return
    if round_.phase == 'asking':
        round_.phase = 'locked'
        round_.locked_at = datetime.utcnow()
    # Score every answer
    score_round(round_)
    round_.phase = 'revealed'
    round_.revealed_at = datetime.utcnow()
    round_.game.phase = 'revealed'
    game = round_.game
    db.session.commit()
    socketio.emit('reveal', round_snapshot(round_, include_correct=True))
    broadcast_leaderboard(game)
    # Refresh full state (resets pending-ready list now we're in reveal)
    broadcast_state(game)
    if game.auto_host and app is not None and game.auto_next_delay_s is not None:
        # Only schedule a timer if a non-null delay is configured. With null,
        # the round only advances when every team has clicked Ready.
        schedule_auto_action(app, game.id, 'next', game.auto_next_delay_s, round_id=round_.id)


def score_round(round_: Round) -> None:
    """Compute points for each answer.

    Rules (per README):
      - +5 for correct
      - +3 for first correct (earliest response_time_ms among correct answers)
    """
    answers = sorted(round_.answers, key=lambda a: a.response_time_ms)
    first_correct_id = None
    for a in answers:
        a.is_correct = is_correct_answer(round_.question, a.answer_text)
        if a.is_correct and first_correct_id is None:
            first_correct_id = a.id
    base = round_.question.points
    for a in answers:
        if not a.is_correct:
            a.points_awarded = 0
            a.is_first_correct = False
            continue
        bonus = 3 if a.id == first_correct_id else 0
        a.points_awarded = base + bonus
        a.is_first_correct = (a.id == first_correct_id)
        # Apply to participant cached score
        gp = db.session.scalar(
            select(GameParticipant).where(
                GameParticipant.game_id == round_.game_id,
                GameParticipant.team_id == a.team_id,
            )
        )
        if gp is not None:
            gp.score += a.points_awarded
    db.session.commit()


def compute_awards(game: Game) -> list[dict]:
    """Special awards across all rounds in this game."""
    rows = db.session.execute(
        select(Answer, Team).join(Team, Team.id == Answer.team_id)
        .join(Round, Round.id == Answer.round_id).where(Round.game_id == game.id)
    ).all()
    if not rows:
        return []

    by_team: dict[int, dict] = {}
    for ans, team in rows:
        t = by_team.setdefault(team.id, {
            'team_id': team.id, 'team_name': team.name, 'color': team.color, 'emoji': team.emoji,
            'attempts': 0, 'correct': 0, 'first_correct': 0, 'total_ms': 0, 'correct_ms': 0,
        })
        t['attempts'] += 1
        if ans.is_correct:
            t['correct'] += 1
            t['correct_ms'] += ans.response_time_ms
            if ans.is_first_correct:
                t['first_correct'] += 1
        t['total_ms'] += ans.response_time_ms

    awards = []
    # Most correct
    most = max(by_team.values(), key=lambda t: (t['correct'], -t['total_ms']))
    if most['correct'] > 0:
        awards.append({
            'title': 'Brainiacs',
            'subtitle': f"Most correct: {most['correct']}",
            'team': most,
            'icon': 'star',
        })
    # Fastest fingers (lowest avg correct ms)
    fast_candidates = [t for t in by_team.values() if t['correct'] > 0]
    if fast_candidates:
        fast = min(fast_candidates, key=lambda t: t['correct_ms'] / max(t['correct'], 1))
        avg_s = (fast['correct_ms'] / fast['correct']) / 1000.0
        awards.append({
            'title': 'Fastest Fingers',
            'subtitle': f"Avg {avg_s:.1f}s on correct answers",
            'team': fast,
            'icon': 'bolt',
        })
    # First to buzz the most
    buzz = max(by_team.values(), key=lambda t: t['first_correct'])
    if buzz['first_correct'] > 0:
        awards.append({
            'title': 'Buzzer Bandits',
            'subtitle': f"First-correct on {buzz['first_correct']} questions",
            'team': buzz,
            'icon': 'sparkle',
        })
    return awards


# ---------- auto-host scheduling ----------

def schedule_auto_lock(app, round_id: int, delay_s: int) -> None:
    def _task():
        eventlet.sleep(max(1, int(delay_s)))
        with app.app_context():
            r = db.session.get(Round, round_id)
            if r is None or r.phase != 'asking':
                return
            # Pass the app so this auto-lock also chains into auto-reveal when
            # auto-host is on.
            lock_round(r, app=app)
    eventlet.spawn(_task)


def schedule_auto_action(app, game_id: int, action: str, delay_s: int,
                          *, round_id: int | None = None) -> None:
    """Fire `action` on the active game after `delay_s` seconds.

    Each task re-checks the game state at fire time and no-ops if anything has
    moved on (admin advanced manually, auto-host disabled, game ended, etc.).
    Pass `round_id` to bind the task to a specific round — used by 'next' so a
    stale timer can't double-advance once the host has already moved on.
    """
    def _task():
        eventlet.sleep(max(1, int(delay_s)))
        with app.app_context():
            game = db.session.get(Game, game_id)
            if game is None or game.state != 'active' or not game.auto_host:
                return
            if action == 'reveal':
                r = db.session.get(Round, game.current_round_id) if game.current_round_id else None
                if r is None or r.phase != 'locked':
                    return
                reveal_round(r, app=app)
            elif action == 'next':
                if round_id is not None and game.current_round_id != round_id:
                    return  # round changed under us
                if game.phase != 'revealed':
                    return
                advance_to_next_or_end(game, app)
    eventlet.spawn(_task)


def _auto_pick_next_question(game: Game) -> Question | None:
    used_ids = set(db.session.scalars(
        select(Round.question_id).where(Round.game_id == game.id)
    ).all())
    q_select = select(Question)
    if used_ids:
        q_select = q_select.where(~Question.id.in_(used_ids))
    if game.category_filter:
        q_select = q_select.where(Question.category == game.category_filter)
    return db.session.scalar(q_select.order_by(db.func.random()))


def advance_to_next_or_end(game: Game, app) -> None:
    """End the game if the target question count is reached; otherwise auto-pick
    the next question. Safe to call repeatedly — caller is expected to have
    already verified the game is in the revealed phase and auto-host is on."""
    target = game.target_question_count
    played = rounds_played(game)
    if target is not None and played >= int(target):
        end_game(game)
        return
    q = _auto_pick_next_question(game)
    if q is None:
        # Out of questions — end the game instead of getting stuck.
        end_game(game)
        return
    try:
        start_round(game, q.id, app)
    except RuntimeError:
        # Race condition (already asking) — ignore
        return


# ---------- ready-up ----------

def mark_ready(game: Game, team: Team, app) -> None:
    """Record that `team` is ready for the next round, and advance immediately
    in auto-host mode if every team is now ready."""
    if not game.current_round_id or game.phase != 'revealed':
        return
    gp = ensure_participant(game, team)
    if gp.ready_round_id == game.current_round_id:
        broadcast_ready(game)
        return
    gp.ready_round_id = game.current_round_id
    db.session.commit()
    broadcast_ready(game)
    if game.auto_host and all_teams_ready(game):
        advance_to_next_or_end(game, app)


# ---------- answer submission ----------

def submit_answer(game: Game, round_: Round, team: Team, text: str) -> Answer:
    """Insert or update a team's answer. Returns the Answer record."""
    if round_.phase != 'asking':
        raise PermissionError("Question is no longer accepting answers")
    if round_.shown_at is None:
        raise RuntimeError("Round has no shown_at timestamp")
    response_ms = max(0, int((datetime.utcnow() - round_.shown_at).total_seconds() * 1000))
    existing = db.session.scalar(
        select(Answer).where(Answer.round_id == round_.id, Answer.team_id == team.id)
    )
    if existing is not None:
        existing.answer_text = text
        existing.submitted_at = datetime.utcnow()
        existing.response_time_ms = response_ms
        db.session.commit()
        return existing
    a = Answer(
        round_id=round_.id,
        team_id=team.id,
        answer_text=text,
        submitted_at=datetime.utcnow(),
        response_time_ms=response_ms,
    )
    db.session.add(a)
    db.session.commit()
    ensure_participant(game, team)
    return a
