import { useEffect, useState } from 'react'

type Health = {
  status: string
  service: string
  env: string
}

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [apiError, setApiError] = useState('')

  useEffect(() => {
    let active = true

    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<Health>
      })
      .then((data) => {
        if (active) setHealth(data)
      })
      .catch((error: Error) => {
        if (active) setApiError(error.message)
      })

    return () => {
      active = false
    }
  }, [])

  const apiReady = health?.status === 'ok'

  return (
    <main className="min-h-screen px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4 border-b border-[#dcd9ce] pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-[#235844] text-sm font-semibold text-[#f7fbf8]">
              A
            </span>
            <span className="display text-xl font-bold tracking-tight">
              Aangan
            </span>
          </div>
          <span className="rounded-full border border-[#dcd9ce] bg-[#fbfaf6] px-3 py-1 text-xs font-medium text-[#68716b]">
            Skeleton setup
          </span>
        </header>

        <section className="grid gap-10 py-14 lg:grid-cols-[1.15fr_.85fr] lg:items-start lg:py-20">
          <div className="min-w-0">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#a85b12]">
              Project setup complete
            </p>
            <h1 className="display max-w-[16ch] text-4xl font-bold leading-[1.02] tracking-[-0.03em] sm:text-6xl">
              See the house finished before the work begins.
            </h1>
            <p className="mt-5 max-w-[52ch] text-base leading-7 text-[#68716b]">
              Frontend and API are connected. The next step is the build in
              <span className="font-medium text-[#1b211e]"> docs/PLAN.md</span>:
              upload, mark regions, apply materials, estimate and report.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <span className="rounded-full bg-[#235844] px-4 py-2 text-sm font-medium text-[#f7fbf8]">
                Upload
              </span>
              <span className="rounded-full border border-[#dcd9ce] bg-[#fbfaf6] px-4 py-2 text-sm text-[#68716b]">
                Mark regions
              </span>
              <span className="rounded-full border border-[#dcd9ce] bg-[#fbfaf6] px-4 py-2 text-sm text-[#68716b]">
                Finishes
              </span>
              <span className="rounded-full border border-[#dcd9ce] bg-[#fbfaf6] px-4 py-2 text-sm text-[#68716b]">
                Estimate
              </span>
              <span className="rounded-full border border-[#dcd9ce] bg-[#fbfaf6] px-4 py-2 text-sm text-[#68716b]">
                Report
              </span>
            </div>
          </div>

          <aside className="min-w-0 rounded-2xl border border-[#dcd9ce] bg-[#fbfaf6] p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#68716b]">
              Connection check
            </p>
            <div className="mt-4 flex items-start gap-3">
              <span
                className={`mt-1 size-2.5 rounded-full ${
                  apiReady
                    ? 'bg-[#2c7a50]'
                    : apiError
                      ? 'bg-[#a22d22]'
                      : 'bg-[#a85b12]'
                }`}
              />
              <div>
                <p className="font-medium">
                  {apiReady
                    ? 'API connected'
                    : apiError
                      ? 'API not reachable'
                      : 'Checking API…'}
                </p>
                <p className="mt-1 text-sm text-[#68716b]">
                  {apiReady
                    ? `${health.service} · ${health.env}`
                    : apiError ||
                      'Start the backend on port 8000 to complete the check.'}
                </p>
              </div>
            </div>

            <hr className="my-5 border-[#dcd9ce]" />

            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#68716b]">
              Local run
            </p>
            <pre className="mt-3 max-w-full overflow-x-auto rounded-xl bg-[#efede5] p-4 text-xs leading-6 text-[#333b36]">
              <code>{`cd backend
uvicorn app.main:app --reload --port 8000

cd frontend
npm run dev`}</code>
            </pre>
            <p className="mt-3 text-xs leading-5 text-[#68716b]">
              Health endpoint: <code>/api/health</code>
            </p>
          </aside>
        </section>

        <footer className="border-t border-[#dcd9ce] pt-5 text-xs text-[#68716b]">
          Skeleton only. No upload, editor, estimate or report code yet.
        </footer>
      </div>
    </main>
  )
}

export default App
