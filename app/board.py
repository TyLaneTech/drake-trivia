"""Scoreboard / big-screen view — public, no login required."""

from flask import Blueprint, render_template

board_bp = Blueprint('board', __name__)


@board_bp.get('/board')
@board_bp.get('/scoreboard')
def scoreboard():
    return render_template('scoreboard.html')
