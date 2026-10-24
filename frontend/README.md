# Frontend

The React app for RenoVision: upload, region marking, materials, estimate, and report screens.

## Run

Start the backend on port 8000 first, then:

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The dev server proxies `/api` to `http://127.0.0.1:8000`.

```bash
npm run build   # typecheck and production build
npm run lint
```

## Layout

```
src/api/         Backend calls and types
src/screens/     One screen per step
src/components/  Shared UI, region tools, finishes preview
src/state/       Workspace state, selection, and saves
src/lib/         Formatting, geometry, and region helpers
```
