"""Player-facing routes: the in-game screen each team uses."""

from flask import Blueprint, redirect, render_template, session, url_for

play_bp = Blueprint('play', __name__)


@play_bp.get('/play')
def play():
    if not session.get('team_name'):
        return redirect(url_for('auth.login'))
    return render_template('play.html')
