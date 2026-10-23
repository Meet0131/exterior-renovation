import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { getErrorMessage } from '../api/client'
import { listProjects } from '../api/projects'
import type { ProjectSummary } from '../api/types'
import { Brand } from '../components/Brand'
import { FacadeStudy } from '../components/FacadeStudy'
import { RecentProjects } from '../components/RecentProjects'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/Field'
import { TextInput } from '../components/ui/TextInput'
import { STEPS } from '../lib/steps'
import { useWorkspace } from '../state/useWorkspace'

export function StartScreen() {
  const { startProject } = useWorkspace()
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const creatingRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()

    void listProjects(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setProjects(items)
      })
      .catch(() => {
        if (!controller.signal.aborted) setProjects([])
      })

    return () => controller.abort()
  }, [])

  const create = async () => {
    if (creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    setError('')

    try {
      await startProject(title)
    } catch (createError) {
      setError(getErrorMessage(createError))
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void create()
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <header className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Brand />
        <span className="hidden text-xs text-muted sm:block">
          Advisory planning, not a contractor quote
        </span>
      </header>

      <main className="mx-auto grid w-full max-w-[1400px] flex-1 items-center gap-10 px-4 pb-12 pt-4 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-16 lg:pt-8">
        <section className="min-w-0">
          <h1 className="display max-w-[13ch] text-[clamp(2.75rem,7vw,5.6rem)] font-bold leading-[0.94] tracking-[-0.05em] text-balance">
            Your house, before the work begins.
          </h1>

          <p className="mt-6 max-w-[52ch] text-base leading-7 text-muted sm:text-lg sm:leading-8">
            Upload one straight-on photo, mark what changes, and try materials
            and colours on your own facade. You leave with measured quantities
            and an advisory cost you can take to a contractor.
          </p>

          <form onSubmit={handleSubmit} className="mt-9 max-w-xl">
            <div className="border-t border-line pt-6">
              <Field
                label="Project name"
                htmlFor="project-title"
                optional
              >
                <TextInput
                  id="project-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. North facade repaint"
                  autoComplete="off"
                  disabled={creating}
                />
              </Field>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button
                  type="submit"
                  size="lg"
                  loading={creating}
                  icon={<ArrowRight className="size-4" />}
                  className="shrink-0"
                >
                  {creating ? 'Starting…' : 'Start a new project'}
                </Button>
              </div>

              {error ? (
                <div
                  role="alert"
                  className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[2px] border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger"
                >
                  <span>{error}</span>
                  <button
                    type="button"
                    onClick={() => {
                      void create()
                    }}
                    className="text-sm font-semibold underline underline-offset-4"
                  >
                    Try again
                  </button>
                </div>
              ) : null}
            </div>
          </form>

          <ol className="mt-9 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
            {STEPS.map((step, index) => (
              <li key={step.id} className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-measure">
                  {index + 1}
                </span>
                <span>{step.label}</span>
                {index < STEPS.length - 1 ? (
                  <span
                    className="ml-1 h-px w-4 bg-line"
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        <aside className="min-w-0 lg:pl-4">
          <div className="space-y-5">
            <FacadeStudy />
            {projects.length > 0 ? (
              <RecentProjects projects={projects} />
            ) : null}
          </div>
        </aside>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1 px-4 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>Advisory estimates, not contractor quotes.</span>
        </div>
      </footer>
    </div>
  )
}
