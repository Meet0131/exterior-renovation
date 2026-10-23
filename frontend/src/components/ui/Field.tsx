import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface FieldProps {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  optional?: boolean
  children: ReactNode
  className?: string
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional = false,
  children,
  className,
}: FieldProps) {
  const helpId = `${htmlFor}-help`

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={htmlFor}
          className="text-sm font-medium text-ink-2"
        >
          {label}
          {optional ? (
            <span className="ml-2 text-xs font-normal text-muted">
              optional
            </span>
          ) : null}
        </label>
      </div>
      {children}
      {error ? (
        <p id={helpId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={helpId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
