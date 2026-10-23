import { AlertCircle, Check, Info } from 'lucide-react'
import { cn } from '../lib/cn'
import type { ToastMessage } from '../state/WorkspaceContext'

const TONE_STYLES = {
  info: {
    icon: Info,
    iconClass: 'text-measure',
    surface: 'bg-measure-soft',
  },
  success: {
    icon: Check,
    iconClass: 'text-ok',
    surface: 'bg-ok-soft',
  },
  error: {
    icon: AlertCircle,
    iconClass: 'text-danger',
    surface: 'bg-danger-soft',
  },
} as const

export function Toast({ toast }: { toast: ToastMessage | null }) {
  if (toast === null) return null

  const tone = TONE_STYLES[toast.tone]
  const Icon = tone.icon

  return (
    <div
      className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-start gap-3 rounded-[2px] border border-line bg-surface p-3 shadow-float sm:left-auto sm:right-6 sm:mx-0"
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span
        className={cn(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-md',
          tone.surface,
        )}
        aria-hidden="true"
      >
        <Icon className={cn('size-4', tone.iconClass)} strokeWidth={2} />
      </span>
      <p className="min-w-0 pt-0.5 text-sm leading-5 text-ink-2">
        {toast.message}
      </p>
    </div>
  )
}
