# Drake Trivia

Interactive real-time trivia app built for the first annual Drake family trivia tournament. Flask + Flask-SocketIO + Postgres, deployed on Railway.

## Live site
- Production: https://drake-trivia-production.up.railway.app

## Stack
- **Web framework:** Flask 3
- **Realtime:** Flask-SocketIO over eventlet (single-process WSGI server)
- **Database:** Postgres (Railway plugin) via Flask-SQLAlchemy + psycopg v3
- **Frontend:** Plain HTML/CSS/JS + socket.io-client (CDN)
- **Hosting:** Railway (Nixpacks build)

## Gameplay
- Teams sign in (one team per device), play through a tournament-style bracket
- Admin pushes questions live; clients receive them over Socket.IO
- Scores update in real time on the scoreboard page

### Scoring
- Correct answers: 5 points
- First to answer: +3 points
- Time spent answering: tracked for tiebreaks
- Double elimination

## Local development

```bash
python -m venv venv
. venv/bin/activate   # or `venv\Scripts\Activate.ps1` on Windows
pip install -r requirements.txt

# .env (or export in your shell)
# FLASK_SECRET_KEY=<any random string>
# DATABASE_URL=sqlite:///drake_trivia.db   # or a local Postgres URL

python app.py
# → http://127.0.0.1:8080
```

If `DATABASE_URL` is unset, the app falls back to a local SQLite file (`drake_trivia.db`).

## Environment variables

| Var                | Required | Notes                                                                |
|--------------------|----------|----------------------------------------------------------------------|
| `FLASK_SECRET_KEY` | yes      | Flask session signing key                                            |
| `DATABASE_URL`     | yes (prod) | Postgres URL. Railway injects this via `${{Postgres.DATABASE_URL}}` |
| `HOST`             | no       | Bind host (default `127.0.0.1` locally; set `0.0.0.0` in prod)       |
| `PORT`             | no       | Bind port (default `8080`; Railway sets this automatically)          |

## Railway deployment

The repo includes `railway.json` (Nixpacks build, `python app.py` start, `/healthz` health check). Push to `main` triggers a new build once the GitHub source is connected (Service → Settings → Source).

Manual deploy from a local working tree:
```bash
railway link --project drake-trivia
railway up --service drake-trivia --detach
```

## Project structure
```
Drake-Trivia/
├── app.py              # Flask app, SocketIO events, SQLAlchemy models
├── requirements.txt
├── railway.json        # Railway/Nixpacks deploy config
├── .python-version     # pins Python 3.11
├── static/
│   ├── images/
│   ├── js/   (admin, global, login, navbar, questions, scores)
│   └── styles/
└── templates/   (base, navbar, login, admin, admin_login, questions, scores)
```
