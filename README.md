# RenoVision — AI-Based Exterior House Renovation & Cost Estimation

A working prototype for uploading a house photo, marking facade regions, applying materials, estimating quantities and costs, and downloading a PDF report.

**Current state:** the backend is implemented (projects, upload, regions, detection, finalize, estimate, PDF); the frontend has the workspace foundation, upload screen, mark-regions screen, finishes screen, estimate screen and report screen (Tasks 1–9): the start screen, project link restore, API layer, workspace state, top bar, stepper, photo upload with server checks, the region editor with polygon and line drawing, draggable point editing, duplicate, surface rules, detection-suggestion review, opening deductions, reference outlines, the ordered list, inspector, live measurements, scale calibration and autosave, per-region material and colour choices with presets, material notes, the unassigned summary, the advisory estimate chip, the live material preview with the before/after slider, the finalize step with the estimate table, editable rates, local totals, 422 recovery and the contingency summary, the report with the stored original and final images, materials and cost tables, PDF download and retry, missing-preview recovery and the estimate fix path, and the multi-photo workspace with switching, project totals and per-photo report recovery (Tasks 1–10). The delivery pass remains. The build order lives in [`docs/PLAN.md`](docs/PLAN.md); frontend tasks are in [`docs/Tasks/frontend_task.md`](docs/Tasks/frontend_task.md); the user journey is in [`docs/userflow.md`](docs/userflow.md); deferred work is in [`docs/Future_plan.md`](docs/Future_plan.md); the schema and API surface are in [`docs/DATABASE_DESIGN.md`](docs/DATABASE_DESIGN.md); frontend screen rules are in [`docs/frontend_design_doc.md`](docs/frontend_design_doc.md); deployment is in [`docs/deployment_plan.md`](docs/deployment_plan.md).

## User workflow

1. **Upload** a straight-on facade photo. The app checks size, sharpness and exposure and explains any rejection.
2. **Mark regions** with the AI suggestions or by hand. Set the scale with one known length, add deductions, and enter a manual measure when needed.
3. **Finishes** applies a material and colour per region. The live preview compares the original with the redesign.
4. **Estimate** shows the measured quantities, editable material and labour rates, and the 5% contingency.
5. **Report** shows the stored final image and downloads the PDF for a contractor conversation.

The full flow, guards and error recovery are in [`docs/userflow.md`](docs/userflow.md).

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

Set the Neon connection string and detection keys in `backend/.env`:

```
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST/DBNAME?ssl=require
ROBOFLOW_API_KEY=your_roboflow_key
GEMINI_API_KEY=your_gemini_key
```

Region detection calls Roboflow's hosted SAM 3 first. Gemini is a fallback used only when SAM 3 fails. Roboflow's free tier includes 10 credits per month (0.0005 credits per image); turn off the default "Data Licensing and Model Training" workspace setting if uploaded photos must not be used for training. Detection sends one downscaled JPEG to Roboflow (or Gemini on fallback), not project titles, rates, regions or other photos.

Run the migrations, then start the app:

```bash
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://127.0.0.1:8000/api/health`

## Logging

The backend writes console logs to stdout and rotating logs to `backend/logs/exterior-renovation.log`. Every API response carries an `X-Request-ID` header; use it to follow one request through route, service, repository and background-render log lines. On Render, stdout is the durable log because the container disk is ephemeral.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The dev server proxies `/api` to `127.0.0.1:8000`.

## Docker

```bash
docker build -t renvision .
docker run --env-file backend/.env -p 8000:8000 renvision
```

The container serves the built React app and the API on one port. Run `alembic upgrade head` against the same `DATABASE_URL` as a release step (or from a one-off container) before the first start; the app does not create tables itself.

## Database

Postgres only, local and deployed. Render and Vercel have ephemeral disks, so a file database would lose projects on restart. The backend uses async SQLAlchemy with asyncpg, so use a Neon URL with `ssl=require`. For the pooled endpoint, append `&prepared_statement_cache_size=0` or use the direct host.

Schema changes are managed with Alembic (`backend/alembic/versions`); the app never creates tables at startup.
