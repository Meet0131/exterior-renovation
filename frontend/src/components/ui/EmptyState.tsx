import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-start gap-4 rounded-[2px] border border-dashed border-line-strong bg-surface/60 p-6 sm:p-8',
        className,
      )}
    >
      {icon ? (
        <div
          className="grid size-11 place-items-center rounded-lg bg-pine-soft text-pine"
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <div className="max-w-[52ch]">
        <h2 className="display text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {description ? (
          <p className="mt-2 text-sm leading-6 text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  )
}
