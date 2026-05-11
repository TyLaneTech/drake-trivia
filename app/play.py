"""Player-facing routes: the in-game screen each team uses."""

from flask import Blueprint, redirect, render_template, session, url_for
from sqlalchemy import select

from . import db
from .models import Game

play_bp = Blueprint('play', __name__)


@play_bp.get('/play')
def play():
    if not session.get('team_name'):
        return redirect(url_for('auth.login'))
    return render_template('play.html')


@play_bp.get('/recap')
def recap_latest():
    """Send the visitor to the most recently ended game's recap."""
    game = db.session.scalar(
        select(Game).where(Game.state == 'ended').order_by(Game.id.desc()).limit(1)
    )
    if game is None:
        return render_template('recap.html', game_id=None, no_games=True)
    return redirect(url_for('play.recap_view', game_id=game.id))


@play_bp.get('/recap/<int:game_id>')
def recap_view(game_id):
    """Recap of a specific finished game. The page loads its data via
    /api/games/<id>/recap, which gates active games out."""
    return render_template('recap.html', game_id=game_id)
