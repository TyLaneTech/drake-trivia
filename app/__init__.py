"""Drake Trivia — Flask app factory + shared extensions."""

import logging
import os

from flask import Flask
from flask_socketio import SocketIO
from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()
socketio = SocketIO(async_mode='eventlet', cors_allowed_origins='*')


def _normalize_db_url(url: str) -> str:
    """Force the psycopg v3 driver; SQLAlchemy's default postgresql:// dialect
    maps to psycopg2, which we don't install."""
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql+psycopg://', 1)
    elif url.startswith('postgresql://') and '+psycopg' not in url.split('://', 1)[0]:
        url = url.replace('postgresql://', 'postgresql+psycopg://', 1)
    return url


def _setup_logging(app: Flask) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        '%(asctime)s [%(levelname)s] %(name)s: %(message)s'
    ))
    root = logging.getLogger()
    if not any(isinstance(h, logging.StreamHandler) for h in root.handlers):
        root.addHandler(handler)
    root.setLevel(logging.INFO)
    for noisy in ('werkzeug', 'engineio', 'socketio', 'urllib3'):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    app.logger.setLevel(logging.INFO)


def create_app() -> Flask:
    required = ['FLASK_SECRET_KEY']
    missing = [v for v in required if not os.getenv(v)]
    if missing:
        raise ValueError(f"Missing required env vars: {', '.join(missing)}")

    app = Flask(__name__, template_folder='../templates', static_folder='../static')
    app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY')
    app.config['SQLALCHEMY_DATABASE_URI'] = _normalize_db_url(
        os.getenv('DATABASE_URL', 'sqlite:///drake_trivia.db')
    )
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['JSON_SORT_KEYS'] = False

    _setup_logging(app)

    db.init_app(app)
    socketio.init_app(app, async_mode='eventlet', cors_allowed_origins='*')

    # Register blueprints
    from .auth import auth_bp
    from .play import play_bp
    from .admin import admin_bp
    from .board import board_bp
    from .api import api_bp
    from .manage import manage_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(play_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(board_bp)
    app.register_blueprint(api_bp)
    app.register_blueprint(manage_bp)

    # Register SocketIO event handlers
    from . import events  # noqa: F401  (side-effect: attaches handlers)

    # Bootstrap: create tables, seed default admin + question pack
    with app.app_context():
        from . import models  # noqa: F401  (ensure models are imported)
        if os.getenv('RESET_DB', '').lower() in ('1', 'true', 'yes'):
            app.logger.warning("RESET_DB set — dropping all tables")
            db.drop_all()
        db.create_all()
        from .seed import bootstrap
        bootstrap(app)

    @app.context_processor
    def inject_globals():
        from flask import session
        return {
            'team_name': session.get('team_name'),
            'is_admin': bool(session.get('is_admin')),
        }

    @app.get('/healthz')
    def healthz():
        return {'status': 'ok'}, 200

    return app
