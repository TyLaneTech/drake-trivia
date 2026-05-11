"""Bootstrap: seed the question bank + default admin on first boot."""

from __future__ import annotations

import json
import logging
import os
import secrets
from pathlib import Path

from sqlalchemy import select
from werkzeug.security import generate_password_hash

from . import db
from .models import AdminUser, Question


log = logging.getLogger(__name__)


def bootstrap(app) -> None:
    _ensure_admin(app)
    _seed_questions(app)


def _ensure_admin(app) -> None:
    existing = db.session.scalar(select(AdminUser).limit(1))
    if existing is not None:
        return
    username = os.getenv('ADMIN_USERNAME', 'admin')
    password = os.getenv('ADMIN_PASSWORD', 'admin')
    admin = AdminUser(
        username=username,
        password_hash=generate_password_hash(password),
        token=secrets.token_hex(32),
    )
    db.session.add(admin)
    db.session.commit()
    app.logger.warning(
        "Seeded default admin user '%s' — change the password via the admin panel.",
        username,
    )


def _seed_questions(app) -> None:
    existing = db.session.scalar(select(db.func.count(Question.id)))
    if existing and existing > 0:
        return
    path = Path(__file__).resolve().parent.parent / 'data' / 'questions.json'
    if not path.exists():
        app.logger.warning("No questions.json found at %s; skipping seed", path)
        return
    with path.open(encoding='utf-8') as fh:
        data = json.load(fh)
    items = data.get('questions') if isinstance(data, dict) else data
    if not isinstance(items, list):
        app.logger.warning("questions.json has no 'questions' list; skipping seed")
        return
    inserted = 0
    for item in items:
        try:
            q = Question(
                type=item.get('type', 'multiple_choice'),
                text=item['text'],
                correct_answer=item['correct_answer'],
                category=item.get('category', 'General'),
                difficulty=item.get('difficulty', 'medium'),
                points=int(item.get('points', 5)),
                time_limit_s=int(item.get('time_limit_s', 30)),
                image_url=item.get('image_url'),
                explanation=item.get('explanation'),
            )
            opts = item.get('options')
            if opts:
                q.options = opts
            elif q.type == 'true_false':
                q.options = ['True', 'False']
            db.session.add(q)
            inserted += 1
        except Exception as e:  # noqa: BLE001
            app.logger.warning("Skipping bad seed question (%s): %s", e, item)
    db.session.commit()
    app.logger.info("Seeded %d questions into the bank", inserted)
