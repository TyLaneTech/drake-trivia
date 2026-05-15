# Drake Trivia — agent reference

Quick orientation for Claude (and other agents) working in this repo.

## Project at a glance

- Flask 3 + Flask-SocketIO over eventlet, served as a single process.
- Postgres in production (Railway), SQLite locally when `DATABASE_URL` is unset.
- Frontend: plain HTML/CSS/JS + the socket.io-client CDN, no build step.
- Entry: `wsgi.py` → `app.create_app()`. Blueprints live in `app/*.py`.
- Question seed bank: `data/questions.json` (loaded on first boot only).

Hosts:
- **Production:** `https://drake-trivia-production.up.railway.app`
- **Local dev:** `http://127.0.0.1:8080` (run `python app.py`)

---

## Question-bank management API (`/api/manage/*`)

**This is the API you (Claude) should use to add, edit, or remove questions and categories in future sessions.** No browser, no admin login — just HTTP.

Defined in [app/manage.py](app/manage.py). All routes return JSON, use standard HTTP status codes, and consistently put errors under `{"error": "..."}`.

### Auth

If the `MANAGE_API_TOKEN` env var is set on the server, every request must include a token. Two options:

- Header: `X-Manage-Token: <token>`
- Query string: `?token=<token>`

If the env var is **unset**, the API is fully open (no auth). The local dev server runs this way by default.

> When the user is in this repo and wants to manage questions, ask whether `MANAGE_API_TOKEN` is set in production. If yes, request the token once, then reuse it.

### Question payload schema

| Field            | Required | Type / values                                                          | Notes                                                                                |
|------------------|----------|------------------------------------------------------------------------|--------------------------------------------------------------------------------------|
| `type`           | yes      | `multiple_choice` \| `true_false` \| `free_text`                       | Defaults to `multiple_choice` if omitted.                                            |
| `text`           | yes      | string                                                                 | The question itself.                                                                  |
| `correct_answer` | yes      | string                                                                 | See per-type rules below.                                                             |
| `options`        | for MC   | array of strings (≥ 2)                                                 | Ignored for `true_false`/`free_text`. For TF, the server forces `["True", "False"]`. |
| `category`       | no       | string (≤ 64 chars)                                                    | Default `General`. Stored verbatim — case-sensitive.                                 |
| `difficulty`     | no       | `easy` \| `medium` \| `hard`                                           | Default `medium`.                                                                     |
| `points`         | no       | int ≥ 1                                                                 | Default `5`.                                                                          |
| `time_limit_s`   | no       | int ≥ 5                                                                 | Default `30`.                                                                         |
| `image_url`      | no       | string \| null                                                         | Optional image to show alongside the question.                                       |
| `explanation`    | no       | string \| null                                                         | Shown on the reveal screen and in the recap.                                         |

**Per-type rules for `correct_answer`:**

- `multiple_choice` — must be **exactly equal** to one of `options` (case- and whitespace-sensitive).
- `true_false` — must be the literal string `True` or `False`.
- `free_text` — case-insensitive substring match at scoring time. Use pipe (`|`) to accept multiple alternates: `"Hannibal|Hannibal Barca"` accepts either. Order doesn't matter for scoring, but UI shows the **first** alternate as the canonical answer, so put the most readable one first.

### Endpoints

| Method | Path                                          | Purpose                                                                |
|--------|-----------------------------------------------|------------------------------------------------------------------------|
| GET    | `/api/manage/schema`                          | Self-describing JSON: schema + endpoint list. Good first call.         |
| GET    | `/api/manage/stats`                           | Total count + breakdowns by category, difficulty, type.                |
| GET    | `/api/manage/questions`                       | List with filters (see below).                                         |
| GET    | `/api/manage/questions/<id>`                  | Fetch one. Includes `referenced_rounds` (whether past games used it). |
| POST   | `/api/manage/questions`                       | Create one. Body = question payload. Returns the created row.          |
| PUT    | `/api/manage/questions/<id>`                  | Replace — all required fields must be present.                          |
| PATCH  | `/api/manage/questions/<id>`                  | Merge — only send fields you want to change.                            |
| DELETE | `/api/manage/questions/<id>`                  | Refuses with 409 if the question is referenced by past rounds.         |
| POST   | `/api/manage/questions/bulk`                  | Bulk create. Body `{"questions": [...]}`. All-or-nothing — any item error rolls back the entire batch. |
| POST   | `/api/manage/questions/bulk_delete`           | Delete by `{"ids": [...]}`, by filter (`category`/`difficulty`/`type`), or `{"all": true}`. Skips referenced questions and returns them under `skipped_referenced`. |
| GET    | `/api/manage/categories`                      | `[{category, count}, ...]`                                              |
| POST   | `/api/manage/categories/rename`               | Body `{"from": "...", "to": "..."}`. Returns affected row count.        |
| DELETE | `/api/manage/categories/<name>`               | Delete every question in a category. Add `?force=true` to also delete questions referenced by past rounds (otherwise they're kept and returned in `skipped_referenced`). |

### Filters for `GET /api/manage/questions`

All optional, combine freely:

- `category=Roman Empire` — exact match
- `difficulty=hard` — exact match (easy/medium/hard)
- `type=multiple_choice` — exact match
- `q=Caesar` — case-insensitive substring across `text` and `correct_answer`
- `ids=1,4,7` — restrict to these ids
- `limit=20` / `offset=0` — pagination
- `format=ids` — return just `[1, 2, 3, ...]`
- `format=compact` — drop `options`/`explanation`/`time_limit_s` for terser listings

---

## Recipes

> All examples assume **no token** (local dev). For production, append `-H 'X-Manage-Token: <token>'` to every call.

### See what's in the bank (start here)

```powershell
curl https://drake-trivia-production.up.railway.app/api/manage/stats
```

### List every Roman Empire question (compact form)

```powershell
curl "https://drake-trivia-production.up.railway.app/api/manage/questions?category=Roman%20Empire&format=compact"
```

### Add a single question

```powershell
$body = @{
  type='multiple_choice'
  text='Which Roman emperor built the wall across northern Britain in 122 AD?'
  options=@('Trajan','Hadrian','Marcus Aurelius','Septimius Severus')
  correct_answer='Hadrian'
  category='Roman Empire'
  difficulty='medium'
  points=5
  time_limit_s=20
  explanation='Built to keep out the Picts; ran ~73 miles coast-to-coast.'
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/api/manage/questions' `
  -ContentType 'application/json' -Body $body
```

### Add many at once

```powershell
$body = @{
  questions = @(
    @{type='true_false'; text='The Colosseum could host naval battles.'; correct_answer='True'; category='Roman Empire'; difficulty='hard'; explanation='Naumachiae — the arena was flooded.'},
    @{type='free_text'; text='Who was the last Western Roman Emperor?'; correct_answer='Romulus Augustulus|Romulus Augustus'; category='Roman Empire'; difficulty='hard'}
  )
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/api/manage/questions/bulk' `
  -ContentType 'application/json' -Body $body
```

> Bulk create is **all-or-nothing**: if any item fails validation, nothing is created and the response lists which items failed (by index).

### Edit one field on an existing question

```powershell
# Bump time limit to 30s — leaves all other fields alone
Invoke-RestMethod -Method Patch -Uri 'http://127.0.0.1:8080/api/manage/questions/42' `
  -ContentType 'application/json' -Body (@{time_limit_s=30} | ConvertTo-Json)
```

### Delete one question

```powershell
Invoke-RestMethod -Method Delete -Uri 'http://127.0.0.1:8080/api/manage/questions/42'
# Returns 409 if the question was used in a past game — to preserve recaps.
```

### Delete a bunch of bad questions by id

```powershell
$body = @{ ids = @(101, 102, 103) } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/api/manage/questions/bulk_delete' `
  -ContentType 'application/json' -Body $body
```

### Rename a category across the whole bank

```powershell
$body = @{ from='Pop Culture'; to='Movies & TV' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/api/manage/categories/rename' `
  -ContentType 'application/json' -Body $body
```

### Drop an entire category

```powershell
# Unreferenced only
Invoke-RestMethod -Method Delete -Uri 'http://127.0.0.1:8080/api/manage/categories/Smoke%20Test'

# Include questions from past games too (DESTRUCTIVE — breaks recaps for those rounds)
Invoke-RestMethod -Method Delete -Uri 'http://127.0.0.1:8080/api/manage/categories/Smoke%20Test?force=true'
```

---

## Workflow tips for Claude

- **Always start with `GET /api/manage/stats`** to see what's there before adding. Avoids creating duplicate categories with slight name variations ("Roman Empire" vs "Roman empire").
- **Use bulk-create when adding more than ~3 questions** — one round-trip, atomic validation. The all-or-nothing semantics mean you don't end up with half a batch on a typo.
- **When asked to "add 20 Music questions"**, generate the array, send it via `POST /api/manage/questions/bulk`, then call `GET /api/manage/stats` to confirm the new count.
- **Reference-protection is by design.** Past games keep their question references for the recap page. To "clean up" a category that's been used, prefer renaming (`/categories/rename`) or filter your reads to exclude it, rather than force-deleting.
- **Multiple-choice gotcha:** `correct_answer` must match exactly one of `options`. The validator compares with `==`, so `"Hadrian"` ≠ `"hadrian "`.
- **Free-text alternates:** the **first** value before the `|` is what's shown on the reveal/recap screens. Put the canonical, well-formatted version first; aliases after.
- **`/api/manage/schema`** is a live document of the API. If something here is out of date, that endpoint is the source of truth.

---

## Other useful files

- [app/models.py](app/models.py) — DB schema. `Question` is the only model the manage API touches.
- [app/admin.py](app/admin.py) — Authenticated admin routes (used by the in-browser dashboard). Validation helpers `_apply_question_payload` / `_question_from_payload` are shared with the manage API.
- [data/questions.json](data/questions.json) — Initial seed. Loaded **only on a fresh DB** (no rows in the `questions` table). Editing this file does NOT change a running database — use the manage API for that.
- [app/seed.py](app/seed.py) — Reads `data/questions.json` and seeds on first boot.

## Local development

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:FLASK_SECRET_KEY = 'dev-secret'
$env:DATABASE_URL = 'sqlite:///drake_trivia.db'   # optional; defaults to this
python app.py
# → http://127.0.0.1:8080
```

To enable the management-API token gate locally:

```powershell
$env:MANAGE_API_TOKEN = 'somelongrandomstring'
python app.py
```
