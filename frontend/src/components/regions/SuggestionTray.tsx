import { useEffect, useRef } from 'react'
import {
  AlertTriangle,
  Check,
  Pencil,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import type { SuggestionReviewItem } from '../../lib/regions'
import { getSurfaceLabel } from '../../lib/regions'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'

interface SuggestionTrayProps {
  suggestions: SuggestionReviewItem[]
  activeKey: string | null
  loading: boolean
  error: string | null
  unavailable: boolean
  truncated: boolean
  onActivate: (key: string) => void
  onAccept: (key: string) => void
  onReject: (key: string) => void
  onAcceptAll: () => void
  onRejectAll: () => void
  onEdit: (key: string) => void
  onRetry: () => void
  onCancel: () => void
}

function roleLabel(role: SuggestionReviewItem['region_role']): string {
  if (role === 'opening') return 'Opening'
  if (role === 'reference') return 'Reference'
  return 'Finish'
}

export function SuggestionTray({
  suggestions,
  activeKey,
  loading,
  error,
  unavailable,
  truncated,
  onActivate,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onEdit,
  onRetry,
  onCancel,
}: SuggestionTrayProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const validCount = suggestions.filter(
    (suggestion) => suggestion.problem === null,
  ).length

  useEffect(() => {
    if (activeKey === null) return
    const item = listRef.current?.querySelector(
      `[data-suggestion-key="${activeKey}"]`,
    )
    item?.scrollIntoView({ block: 'nearest' })
  }, [activeKey])

  return (
    <section
      aria-labelledby="suggestion-tray-heading"
      className="rounded-[2px] border border-amber/30 bg-surface p-4 shadow-sheet sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-amber-soft text-amber">
            <Sparkles className="size-3.5" aria-hidden="true" />
          </span>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-amber">
              AI suggestions
            </p>
            <h2
              id="suggestion-tray-heading"
              className="display mt-0.5 text-lg font-semibold tracking-tight"
            >
              Suggested regions
            </h2>
          </div>
        </div>
        {suggestions.length > 0 ? (
          <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted">
            {suggestions.length}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-[2px] border border-line bg-surface-2/40 px-3 py-2.5">
          <span className="inline-flex items-center gap-2 text-xs font-medium text-ink-2">
            <span
              className="size-3.5 animate-spin rounded-full border-2 border-amber/30 border-t-amber"
              aria-hidden="true"
            />
            Reading photo…
          </span>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : null}

      {error !== null ? (
        <div
          role="alert"
          className={cn(
            'mt-3 flex items-start gap-2 rounded-[2px] border px-3 py-2.5 text-xs leading-5',
            unavailable
              ? 'border-amber/30 bg-amber-soft/70 text-ink-2'
              : 'border-danger/30 bg-danger-soft text-danger',
          )}
        >
          <AlertTriangle
            className={cn(
              'mt-0.5 size-3.5 shrink-0',
              unavailable ? 'text-amber' : 'text-danger',
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p>{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2"
            >
              <RefreshCw className="size-3" aria-hidden="true" />
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {truncated ? (
        <div className="mt-3 rounded-[2px] border border-line bg-surface-2/40 px-3 py-2 text-[10px] leading-4 text-muted">
          Showing the first 20 suggestions.
        </div>
      ) : null}

      {suggestions.length > 0 ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={onAcceptAll}
              disabled={loading || validCount === 0}
              icon={<Check className="size-3.5" aria-hidden="true" />}
            >
              Accept all
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onRejectAll}
              disabled={loading}
            >
              Reject all
            </Button>
            {validCount < suggestions.length ? (
              <span className="text-[10px] leading-4 text-muted">
                {suggestions.length - validCount}{' '}
                {suggestions.length - validCount === 1
                  ? 'needs an edit first.'
                  : 'need an edit first.'}
              </span>
            ) : null}
          </div>

          <ul
            ref={listRef}
            className="mt-3 max-h-[26rem] space-y-2 overflow-y-auto overscroll-contain pr-1"
          >
            {suggestions.map((suggestion) => {
              const active = suggestion.key === activeKey

              return (
              <li
                key={suggestion.key}
                data-suggestion-key={suggestion.key}
                tabIndex={0}
                aria-current={active ? 'true' : undefined}
                aria-label={`Highlight ${suggestion.name} on the photo`}
                onClick={() => onActivate(suggestion.key)}
                onFocus={(event) => {
                  if (event.currentTarget.matches(':focus-visible')) {
                    onActivate(suggestion.key)
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    event.target !== event.currentTarget ||
                    (event.key !== 'Enter' && event.key !== ' ')
                  ) {
                    return
                  }
                  event.preventDefault()
                  onActivate(suggestion.key)
                }}
                className={cn(
                  'relative cursor-pointer overflow-hidden rounded-[2px] border px-3 py-2.5 transition-colors',
                  active
                    ? suggestion.problem === null
                      ? 'border-amber bg-amber-soft shadow-sm ring-2 ring-amber/50'
                      : 'border-danger bg-danger-soft shadow-sm ring-2 ring-danger/45'
                    : suggestion.problem === null
                      ? 'border-line bg-surface-2/35 hover:border-amber/50'
                      : 'border-danger/25 bg-danger-soft/35 hover:border-danger/50',
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-y-0 left-0 w-1',
                      suggestion.problem === null
                        ? 'bg-amber'
                        : 'bg-danger',
                    )}
                  />
                ) : null}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {suggestion.name}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted">
                      {getSurfaceLabel(suggestion.surface_type)} ·{' '}
                      {roleLabel(suggestion.region_role)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-line bg-surface px-1.5 py-0.5 font-mono text-[9px] text-muted">
                    {Math.round(suggestion.confidence * 100)}%
                  </span>
                </div>

                {suggestion.problem !== null ? (
                  <p className="mt-1.5 text-[10px] leading-4 text-danger">
                    {suggestion.problem}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      onAccept(suggestion.key)
                    }}
                    disabled={loading || suggestion.problem !== null}
                    icon={<Check className="size-3" aria-hidden="true" />}
                    className="h-7 px-2 text-[11px]"
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(event) => {
                      event.stopPropagation()
                      onEdit(suggestion.key)
                    }}
                    disabled={loading}
                    icon={<Pencil className="size-3" aria-hidden="true" />}
                    className="h-7 px-2 text-[11px]"
                  >
                    Edit first
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation()
                      onReject(suggestion.key)
                    }}
                    disabled={loading}
                    icon={<X className="size-3" aria-hidden="true" />}
                    className="h-7 px-2 text-[11px]"
                  >
                    Reject
                  </Button>
                </div>
              </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </section>
  )
}
