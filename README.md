# RenoVision

RenoVision turns a photo of a house facade into a renovation plan: mark the surfaces, choose materials and colours, get quantities and a cost estimate, and download a PDF report.

It is a working prototype with one FastAPI backend, one React app, and PostgreSQL storage.

## How it works

1. **Upload** a straight-on facade photo. Photos that are too small, blurry, or badly exposed are rejected with a reason.
2. **Mark regions** with AI suggestions or by hand, then set the scale with one known length.
3. **Choose materials and colours** for each surface and preview the result on the photo.
4. **Check the estimate**: measured quantities, editable material and labour rates, and a 5% contingency.
5. **Open the report**: original and proposed images, the cost tables, and a downloadable PDF.

## Stack

React 19, TypeScript, Vite, and Tailwind CSS 4 on the frontend. FastAPI, async SQLAlchemy, Alembic, and PostgreSQL on the backend.

## Layout

```
backend/    FastAPI app, models, migrations, PDF rendering
frontend/   React app
Dockerfile  Single image that serves the API and the built app
```

## Prerequisites

- Python 3.11
- Node.js 24 and npm
- A PostgreSQL database (Neon works)

## Run locally

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Set the database URL in `backend/.env`:

```
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST/DBNAME?ssl=require
```

AI region suggestions also need `ROBOFLOW_API_KEY` (primary) and optionally `GEMINI_API_KEY` (fallback). Regions can always be drawn by hand without them.

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The dev server proxies `/api` to port 8000.

Health check: `curl http://127.0.0.1:8000/api/health`

## Docker

```bash
docker build -t renovision .
docker run --env-file backend/.env -p 8000:8000 renovision
```

The image serves the built app and the API on one port. Run `alembic upgrade head` against the same database before the first start; the app does not create tables itself.

## Notes

- Migrations live in `backend/alembic/versions`. Apply them with Alembic after schema changes.
- For Neon's pooled endpoint, add `&prepared_statement_cache_size=0` to the URL or use the direct host.
- The backend also writes rotating logs under `backend/logs/`. In a container, stdout is the durable log.
