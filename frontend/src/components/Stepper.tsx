import { Fragment } from 'react'
import { Check } from 'lucide-react'
import { STEPS } from '../lib/steps'
import { cn } from '../lib/cn'
import { useWorkspace } from '../state/useWorkspace'

export function Stepper() {
  const { step, navigate } = useWorkspace()
  const currentIndex = STEPS.findIndex((item) => item.id === step)

  return (
    <div className="border-t border-line bg-surface/80">
      <div className="mx-auto max-w-[1400px] overflow-x-auto px-4 py-2 sm:px-8">
        <nav
          aria-label="Project steps"
          className="flex flex-wrap items-center gap-1 sm:min-w-max"
        >
          {STEPS.map((item, index) => {
            const active = item.id === step
            const done = index < currentIndex

            return (
              <Fragment key={item.id}>
                {index > 0 ? (
                  <span
                    aria-hidden="true"
                    className="hidden h-px w-4 shrink-0 bg-line sm:block sm:w-8"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    void navigate(item.id)
                  }}
                  aria-current={active ? 'step' : undefined}
                  aria-label={item.label}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border border-transparent px-2 py-1.5 text-xs font-medium transition-colors sm:text-[13px]',
                    active
                      ? 'bg-pine-soft text-pine'
                      : done
                        ? 'text-ink-2 hover:bg-surface-2'
                        : 'text-muted hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-6 place-items-center rounded-full border font-mono text-[11px]',
                      active
                        ? 'border-pine bg-pine text-on-pine'
                        : done
                          ? 'border-transparent bg-ok-soft text-ok'
                          : 'border-line-strong bg-surface text-muted',
                    )}
                  >
                    {done ? (
                      <Check className="size-3.5" strokeWidth={2.2} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span>{item.label}</span>                </button>
              </Fragment>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
