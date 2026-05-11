"""SQLAlchemy models for Drake Trivia.

Schema:
- Team           : a competing team (one device per team)
- AdminUser      : the game host
- Question       : a question in the bank
- Game           : a singleton-ish session of trivia (state machine lives here)
- GameParticipant: which teams are in a given game + cached score
- Round          : one question shown in one game (the unit of gameplay)
- Answer         : a team's submitted answer to a Round
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from . import db


# ---------- Teams + Admin ----------

class Team(db.Model):
    __tablename__ = 'teams'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    color: Mapped[str] = mapped_column(String(16), default='#8b1d2a')
    # Emblem slug — references an SVG symbol id in /static/images/sprite.svg.
    # Field is named "emoji" for back-compat; treat as opaque identifier.
    emoji: Mapped[str] = mapped_column(String(32), default='target')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    participations: Mapped[list['GameParticipant']] = relationship(back_populates='team')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'color': self.color,
            'emoji': self.emoji,
        }


class AdminUser(db.Model):
    __tablename__ = 'admin_users'

    username: Mapped[str] = mapped_column(String(64), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    token: Mapped[str] = mapped_column(String(128), nullable=False)


# ---------- Question bank ----------

class Question(db.Model):
    __tablename__ = 'questions'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(20), default='multiple_choice')  # multiple_choice|true_false|free_text
    text: Mapped[str] = mapped_column(Text, nullable=False)
    correct_answer: Mapped[str] = mapped_column(String(256), nullable=False)
    options_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON list of strings for MC
    category: Mapped[str] = mapped_column(String(64), default='General')
    difficulty: Mapped[str] = mapped_column(String(16), default='medium')  # easy|medium|hard
    points: Mapped[int] = mapped_column(Integer, default=5)
    time_limit_s: Mapped[int] = mapped_column(Integer, default=30)
    image_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    explanation: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    @property
    def options(self) -> list[str]:
        if not self.options_json:
            return []
        try:
            return json.loads(self.options_json)
        except (ValueError, TypeError):
            return []

    @options.setter
    def options(self, value: list[str] | None) -> None:
        self.options_json = json.dumps(value) if value else None

    def to_admin_dict(self):
        return {
            'id': self.id,
            'type': self.type,
            'text': self.text,
            'correct_answer': self.correct_answer,
            'options': self.options,
            'category': self.category,
            'difficulty': self.difficulty,
            'points': self.points,
            'time_limit_s': self.time_limit_s,
            'image_url': self.image_url,
            'explanation': self.explanation,
        }

    def to_player_dict(self):
        """Safe view for players — never includes the correct answer."""
        return {
            'id': self.id,
            'type': self.type,
            'text': self.text,
            'options': self.options,
            'category': self.category,
            'difficulty': self.difficulty,
            'points': self.points,
            'time_limit_s': self.time_limit_s,
            'image_url': self.image_url,
        }


# ---------- Game session ----------

class Game(db.Model):
    __tablename__ = 'games'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), default='Drake Trivia Night')
    state: Mapped[str] = mapped_column(String(20), default='pending')  # pending|active|ended
    phase: Mapped[str] = mapped_column(String(20), default='waiting')  # waiting|asking|locked|revealed|finale
    current_round_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey('rounds.id'), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    participants: Mapped[list['GameParticipant']] = relationship(
        back_populates='game',
        foreign_keys='GameParticipant.game_id',
    )
    rounds: Mapped[list['Round']] = relationship(
        back_populates='game',
        foreign_keys='Round.game_id',
    )

    current_round: Mapped[Optional['Round']] = relationship(
        foreign_keys=[current_round_id],
        post_update=True,
    )


class GameParticipant(db.Model):
    __tablename__ = 'game_participants'
    __table_args__ = (UniqueConstraint('game_id', 'team_id', name='uq_game_team'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey('games.id'), nullable=False)
    team_id: Mapped[int] = mapped_column(Integer, ForeignKey('teams.id'), nullable=False)
    score: Mapped[int] = mapped_column(Integer, default=0)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    game: Mapped[Game] = relationship(back_populates='participants', foreign_keys=[game_id])
    team: Mapped[Team] = relationship(back_populates='participations', foreign_keys=[team_id])


class Round(db.Model):
    __tablename__ = 'rounds'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey('games.id'), nullable=False)
    question_id: Mapped[int] = mapped_column(Integer, ForeignKey('questions.id'), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=0)  # 1-based round number within the game
    shown_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    locked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revealed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    phase: Mapped[str] = mapped_column(String(20), default='pending')  # pending|asking|locked|revealed

    game: Mapped[Game] = relationship(back_populates='rounds', foreign_keys=[game_id])
    question: Mapped[Question] = relationship()
    answers: Mapped[list['Answer']] = relationship(back_populates='round_', cascade='all, delete-orphan')


class Answer(db.Model):
    __tablename__ = 'answers'
    __table_args__ = (UniqueConstraint('round_id', 'team_id', name='uq_round_team'),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    round_id: Mapped[int] = mapped_column(Integer, ForeignKey('rounds.id'), nullable=False)
    team_id: Mapped[int] = mapped_column(Integer, ForeignKey('teams.id'), nullable=False)
    answer_text: Mapped[str] = mapped_column(Text, default='')
    submitted_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    response_time_ms: Mapped[int] = mapped_column(Integer, default=0)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    is_first_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    points_awarded: Mapped[int] = mapped_column(Integer, default=0)

    round_: Mapped[Round] = relationship(back_populates='answers')
    team: Mapped[Team] = relationship()
