"""Drake Trivia launcher — entry point for `python wsgi.py` and Railway."""

import eventlet
eventlet.monkey_patch()

import os

from dotenv import load_dotenv

load_dotenv()

from app import create_app, socketio  # noqa: E402  (monkey_patch must come first)


app = create_app()


if __name__ == '__main__':
    host = os.getenv('HOST', '127.0.0.1')
    port = int(os.getenv('PORT', 8080))
    print(f"Starting Drake Trivia on http://{host}:{port}/")
    socketio.run(app, host=host, port=port, debug=False)
