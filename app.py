import eventlet
eventlet.monkey_patch()

import os
import json
import secrets
import logging
from datetime import datetime

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import String, Boolean, Integer, Float, DateTime, Text, select
from sqlalchemy.orm import Mapped, mapped_column
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv

load_dotenv()


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    for name in ('werkzeug', 'urllib3', 'engineio', 'socketio'):
        logging.getLogger(name).setLevel(logging.WARNING)


db = SQLAlchemy()
socketio = SocketIO(async_mode='eventlet', cors_allowed_origins='*')


class Team(db.Model):
    __tablename__ = 'teams'
    name: Mapped[str] = mapped_column(String(128), primary_key=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    score: Mapped[int] = mapped_column(Integer, default=0)


class Question(db.Model):
    __tablename__ = 'questions'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    text: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text, default='')
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Score(db.Model):
    __tablename__ = 'scores'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_id: Mapped[str] = mapped_column(String(64), index=True)
    team: Mapped[str] = mapped_column(String(128), index=True)
    answer: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[str] = mapped_column(String(64))
    score: Mapped[int] = mapped_column(Integer, default=0)


class AdminUser(db.Model):
    __tablename__ = 'admin_users'
    username: Mapped[str] = mapped_column(String(64), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    token: Mapped[str] = mapped_column(String(128))


def _normalize_db_url(url: str) -> str:
    # Railway/Heroku-style postgres:// → SQLAlchemy expects postgresql://
    if url.startswith('postgres://'):
        url = url.replace('postgres://', 'postgresql://', 1)
    return url


def create_app() -> Flask:
    required = ['FLASK_SECRET_KEY']
    missing = [v for v in required if not os.getenv(v)]
    if missing:
        raise ValueError(f"Missing required environment variables: {', '.join(missing)}")

    app = Flask(__name__)
    app.config['SECRET_KEY'] = os.getenv('FLASK_SECRET_KEY')

    db_url = os.getenv('DATABASE_URL', 'sqlite:///drake_trivia.db')
    app.config['SQLALCHEMY_DATABASE_URI'] = _normalize_db_url(db_url)
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

    db.init_app(app)
    socketio.init_app(app)

    with app.app_context():
        db.create_all()

    def calculate_score(team, answer, timestamp):
        # TODO: real scoring logic
        return 0

    @app.context_processor
    def inject_defaults():
        return {
            'endpoint': request.endpoint,
            'userIP': request.remote_addr,
        }

    @app.before_request
    def log_request():
        endpoint = str(request.path)
        if endpoint.startswith('/static/') or endpoint.startswith('/socket.io/'):
            return
        if endpoint == '/' and request.method == 'GET':
            return
        username = session.get('username') or session.get('team_name') or request.remote_addr
        app.logger.info(f'{username} - {request.method} {endpoint}')

    @app.route('/')
    def index():
        return redirect(url_for('login'))

    @app.route('/logout')
    def logout():
        session.clear()
        return redirect(url_for('index'))

    @app.route('/login', methods=['GET', 'POST'])
    def login():
        if request.method == 'POST':
            team_name = (request.form.get('team_name') or '').strip()
            if team_name:
                team = db.session.get(Team, team_name)
                if team is None:
                    team = Team(name=team_name, active=True, score=0)
                    db.session.add(team)
                else:
                    team.active = True
                db.session.commit()
                session['team_name'] = team_name
                return redirect(url_for('scores'))
        return render_template('login.html')

    @app.route('/admin-login', methods=['GET', 'POST'])
    def admin_login():
        if request.method == 'GET':
            return render_template('admin_login.html')

        data = request.get_json(silent=True) or {}
        username = data.get('username')
        password = data.get('password')
        if not username or not password:
            return jsonify({'error': 'Missing credentials'}), 400

        admin = db.session.get(AdminUser, 'admin')
        if admin is None:
            # First-time setup: create the admin
            token = secrets.token_hex(32)
            admin = AdminUser(
                username='admin',
                password_hash=generate_password_hash(password),
                token=token,
            )
            db.session.add(admin)
            db.session.commit()
            session['is_admin'] = True
            session['admin_token'] = token
            return jsonify({'redirect': url_for('admin')})

        if username == admin.username and check_password_hash(admin.password_hash, password):
            admin.token = secrets.token_hex(32)
            db.session.commit()
            session['is_admin'] = True
            session['admin_token'] = admin.token
            return jsonify({'redirect': url_for('admin')})
        return jsonify({'error': 'Invalid credentials'}), 401

    @app.route('/admin')
    def admin():
        if not session.get('is_admin'):
            return redirect(url_for('admin_login'))
        admin_user = db.session.get(AdminUser, 'admin')
        if admin_user is None or session.get('admin_token') != admin_user.token:
            session.clear()
            return redirect(url_for('admin_login'))
        return render_template('admin.html')

    @app.route('/api/admin/check', methods=['GET'])
    def check_admin_exists():
        exists = db.session.get(AdminUser, 'admin') is not None
        return jsonify({'exists': exists})

    @app.route('/api/admin/setup', methods=['POST'])
    def setup_admin():
        data = request.get_json(silent=True) or {}
        username = data.get('username')
        password = data.get('password')
        if not username or not password:
            return jsonify({'error': 'Missing credentials'}), 400

        if db.session.get(AdminUser, 'admin') is not None:
            return jsonify({'error': 'Admin already exists'}), 400

        token = secrets.token_hex(32)
        admin = AdminUser(
            username='admin',
            password_hash=generate_password_hash(password),
            token=token,
        )
        db.session.add(admin)
        db.session.commit()
        session['is_admin'] = True
        session['admin_token'] = token
        return jsonify({'redirect': url_for('admin')})

    @app.route('/questions')
    def questions():
        if 'team_name' not in session:
            return redirect(url_for('login'))
        return render_template('questions.html', team=session['team_name'])

    @app.route('/scores')
    def scores():
        return render_template('scores.html')

    @app.route('/api/submit_answer', methods=['POST'])
    def handle_answer():
        try:
            data = request.get_json(silent=True) or {}
            team = data.get('team')
            answer = data.get('answer')
            question_id = str(data.get('question_id'))
            timestamp = data.get('timestamp')

            score_value = calculate_score(team, answer, timestamp)
            entry = Score(
                question_id=question_id,
                team=team,
                answer=answer,
                timestamp=timestamp,
                score=score_value,
            )
            db.session.add(entry)
            db.session.commit()

            socketio.emit('score_update', {
                'team': team,
                'new_score': score_value,
                'question_id': question_id,
            })

            return jsonify({'status': 'success'})
        except Exception as e:
            app.logger.exception("Error handling answer")
            return jsonify({'error': str(e)}), 500

    @app.route('/api/questions/current', methods=['GET'])
    def get_current_question():
        q = db.session.scalar(select(Question).where(Question.is_current.is_(True)))
        if q is None:
            return jsonify({'error': 'No current question'}), 404
        return jsonify({
            'id': q.id,
            'text': q.text,
            'answer': q.answer,
        })

    @app.route('/api/scores', methods=['GET'])
    def get_scores():
        entries = db.session.scalars(select(Score)).all()
        return jsonify([
            {
                'team': e.team,
                'question': e.question_id,
                'score': e.score,
                'timestamp': e.timestamp,
            }
            for e in entries
        ])

    @app.route('/healthz')
    def healthz():
        return jsonify({'status': 'ok'}), 200

    # ---- Socket.IO events ----
    @socketio.on('connect')
    def _on_connect():
        app.logger.info(f"Socket connected: {request.sid}")

    @socketio.on('disconnect')
    def _on_disconnect():
        app.logger.info(f"Socket disconnected: {request.sid}")

    @socketio.on('question')
    def _on_question(message):
        # Admin pushes a question; broadcast to everyone
        socketio.emit('question', message)

    return app


setup_logging()
app = create_app()


if __name__ == '__main__':
    port = int(os.getenv('PORT', 8080))
    host = os.getenv('HOST', '127.0.0.1')
    print(f"Starting app on http://{host}:{port}/")
    socketio.run(app, host=host, port=port, debug=False)
