# Aangan — AI-Based Exterior House Renovation & Cost Estimation

A working prototype for uploading a house photo, marking facade regions, applying materials, estimating quantities and costs, and downloading a PDF report.

**Current state:** project skeleton only. No upload, editor, estimate or report code yet. The build order lives in [`docs/PLAN.md`](docs/PLAN.md); deferred work is in [`docs/Future_plan.md`](docs/Future_plan.md); the schema and API surface are in [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md); frontend screen rules are in [`docs/frontend_design_doc.md`](docs/frontend_design_doc.md).

## Structure

```
backend/       FastAPI app (routes, services, repositories, DI), async SQLAlchemy, Alembic
frontend/      Vite + React + TypeScript + Tailwind shell
docs/          PLAN.md, Future_plan.md, DATABASE_DESIGN.md, frontend_design_doc.md, materials.example.json, mockup, requirements
```

## Prerequisites

- Python 3.11
- Node 24 and npm
- A Neon PostgreSQL database (free tier)

## Backend

```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set the Neon connection string in `backend/.env`:

```
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST/DBNAME?ssl=require
GEMINI_API_KEY=your_key
```

Run the migrations, then start the app:

```bash
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://127.0.0.1:8000/api/health`

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The dev server proxies `/api` to `127.0.0.1:8000`.

## Docker

```bash
docker build -t aangan .
docker run --env-file backend/.env -p 8000:8000 aangan
```

The container serves the built React app and the API on one port. Run `alembic upgrade head` against the same `DATABASE_URL` as a release step (or from a one-off container) before the first start; the app does not create tables itself.

## Database

Postgres only, local and deployed. Render and Vercel have ephemeral disks, so a file database would lose projects on restart. The backend uses async SQLAlchemy with asyncpg, so use a Neon URL with `ssl=require`. For the pooled endpoint, append `&prepared_statement_cache_size=0` or use the direct host.

Schema changes are managed with Alembic (`backend/alembic/versions`); the app never creates tables at startup.
