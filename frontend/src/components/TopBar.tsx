import { useEffect, useRef, useState } from 'react'
import { Check, Link2, RotateCcw } from 'lucide-react'
import { useWorkspace } from '../state/useWorkspace'
import { Brand } from './Brand'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Spinner } from './ui/Spinner'
import { TextInput } from './ui/TextInput'

function SaveState({ compact = false }: { compact?: boolean }) {
  const { saveState, saveError, retrySave } = useWorkspace()

  if (saveState === 'saving') {
    if (compact) {
      return (
        <span title="Saving">
          <span className="sr-only">Saving</span>
          <Spinner className="size-3.5 text-muted" />
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Spinner className="size-3.5" />
        Saving…
      </span>
    )
  }

  if (saveState === 'error') {
    if (compact) {
      return (
        <button
          type="button"
          onClick={() => {
            void retrySave()
          }}
          aria-label="Couldn’t save. Retry."
          title={saveError ?? 'Couldn’t save. Retry.'}
          className="inline-flex size-8 items-center justify-center rounded-md text-danger"
        >
          <span className="sr-only">Couldn’t save. Retry.</span>
          <RotateCcw className="size-3.5" />
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={() => {
          void retrySave()
        }}
        title={saveError ?? undefined}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-danger hover:underline"
      >
        <RotateCcw className="size-3.5" />
        Couldn’t save — Retry
      </button>
    )
  }

  if (saveState === 'saved') {
    if (compact) {
      return (
        <span title="Saved">
          <span className="sr-only">Saved</span>
          <Check className="size-3.5 text-ok" strokeWidth={2.2} />
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Check className="size-3.5 text-ok" strokeWidth={2.2} />
        Saved
      </span>
    )
  }

  return null
}

export function TopBar() {
  const {
    project,
    projectTitleDraft,
    setProjectTitleDraft,
    commitProjectTitle,
    copyProjectLink,
  } = useWorkspace()
  const [manualUrl, setManualUrl] = useState<string | null>(null)
  const copyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (manualUrl === null) return
    copyInputRef.current?.focus()
    copyInputRef.current?.select()
  }, [manualUrl])

  if (project === null) return null

  const handleCopy = async () => {
    const result = await copyProjectLink()
    if (result === 'manual') {
      setManualUrl(window.location.href)
    } else {
      setManualUrl(null)
    }
  }

  return (
    <div className="relative">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-8">
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pine"
          aria-label="RenoVision home, opens in a new tab"
        >
          <Brand />
        </a>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="hidden size-1.5 shrink-0 rounded-full bg-pine sm:block"
            aria-hidden="true"
          />
          <input
            value={projectTitleDraft}
            onChange={(event) => setProjectTitleDraft(event.target.value)}
            onBlur={() => {
              void commitProjectTitle()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
              if (event.key === 'Escape') {
                setProjectTitleDraft(project.title)
                event.currentTarget.blur()
              }
            }}
            aria-label="Project name"
            autoComplete="off"
            className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm font-semibold text-ink transition-colors hover:border-line focus:border-pine focus:bg-surface focus:outline-none focus:ring-2 focus:ring-pine/15"
          />
        </div>

        <div className="flex items-center sm:hidden" aria-live="polite">
          <SaveState compact />
        </div>

        <div className="hidden items-center sm:flex" aria-live="polite">
          <SaveState />
        </div>

        <IconButton
          label="Copy project link"
          icon={<Link2 className="size-4" />}
          onClick={() => {
            void handleCopy()
          }}
          aria-expanded={manualUrl !== null}
          aria-controls="project-link-panel"
        />
      </div>

      {manualUrl !== null ? (
        <div
          id="project-link-panel"
          className="absolute right-4 top-full z-50 mt-2 w-[min(92vw,28rem)] rounded-[2px] border border-line bg-surface p-3 shadow-float sm:right-8"
        >
          <label
            htmlFor="project-link"
            className="text-xs font-medium text-ink-2"
          >
            Copy this link
          </label>
          <TextInput
            ref={copyInputRef}
            id="project-link"
            readOnly
            value={manualUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-2 h-9 text-xs"
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setManualUrl(null)}
            >
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
