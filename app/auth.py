"""Team + admin authentication blueprint."""

from __future__ import annotations

import secrets

from flask import Blueprint, jsonify, redirect, render_template, request, session, url_for
from sqlalchemy import select
from werkzeug.security import check_password_hash, generate_password_hash

from . import db
from .game import broadcast_state, ensure_participant, get_or_create_active_game
from .models import AdminUser, Team


auth_bp = Blueprint('auth', __name__)


@auth_bp.get('/')
def index():
    if session.get('team_name'):
        return redirect(url_for('play.play'))
    if session.get('is_admin'):
        return redirect(url_for('admin.dashboard'))
    return redirect(url_for('auth.login'))


@auth_bp.get('/logout')
def logout():
    session.clear()
    return redirect(url_for('auth.login'))


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        name = (request.form.get('team_name') or '').strip()
        color = (request.form.get('color') or '#d61f2b').strip()[:16]
        emoji = (request.form.get('emoji') or '🎯').strip()[:8]
        if not name:
            return render_template('login.html', error='Enter a team name to continue.')
        if len(name) > 80:
            return render_template('login.html', error='Team name is too long (max 80 chars).')

        team = db.session.scalar(select(Team).where(Team.name == name))
        if team is None:
            team = Team(name=name, color=color, emoji=emoji)
            db.session.add(team)
        else:
            team.color = color
            team.emoji = emoji
        db.session.commit()

        # Auto-join the active game if there is one (or create one in waiting)
        game = get_or_create_active_game()
        ensure_participant(game, team)
        broadcast_state(game)

        session.permanent = True
        session['team_name'] = team.name
        session['team_id'] = team.id
        session['team_color'] = team.color
        session['team_emoji'] = team.emoji
        return redirect(url_for('play.play'))

    teams = db.session.scalars(select(Team).order_by(Team.created_at.asc())).all()
    return render_template('login.html', existing_teams=[t.to_dict() for t in teams])


@auth_bp.route('/admin-login', methods=['GET', 'POST'])
def admin_login():
    if request.method == 'GET':
        return render_template('admin_login.html')

    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    if not username or not password:
        return jsonify({'error': 'Username and password are required.'}), 400

    admin = db.session.get(AdminUser, username)
    if admin is None:
        # First-time setup: anyone with the admin path can claim it
        any_admin = db.session.scalar(select(AdminUser).limit(1))
        if any_admin is None:
            token = secrets.token_hex(32)
            admin = AdminUser(
                username=username,
                password_hash=generate_password_hash(password),
                token=token,
            )
            db.session.add(admin)
            db.session.commit()
            session['is_admin'] = True
            session['admin_username'] = username
            session['admin_token'] = token
            return jsonify({'redirect': url_for('admin.dashboard'), 'created': True})
        return jsonify({'error': 'Invalid credentials.'}), 401

    if not check_password_hash(admin.password_hash, password):
        return jsonify({'error': 'Invalid credentials.'}), 401

    admin.token = secrets.token_hex(32)
    db.session.commit()
    session['is_admin'] = True
    session['admin_username'] = admin.username
    session['admin_token'] = admin.token
    return jsonify({'redirect': url_for('admin.dashboard')})


@auth_bp.get('/api/admin/check')
def admin_check():
    any_admin = db.session.scalar(select(AdminUser).limit(1))
    return jsonify({'exists': any_admin is not None})
