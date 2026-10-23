import { AlertCircle, Info, TriangleAlert, X } from 'lucide-react'
import { cn } from '../lib/cn'
import type {
  BannerMessage,
  BannerTone,
} from '../state/WorkspaceContext'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'

const TONE_STYLES: Record<
  BannerTone,
  { icon: typeof Info; surface: string; iconClass: string }
> = {
  info: {
    icon: Info,
    surface: 'bg-measure-soft',
    iconClass: 'text-measure',
  },
  warning: {
    icon: TriangleAlert,
    surface: 'bg-amber-soft',
    iconClass: 'text-amber',
  },
  error: {
    icon: AlertCircle,
    surface: 'bg-danger-soft',
    iconClass: 'text-danger',
  },
}

interface BannerProps {
  banner: BannerMessage | null
  onDismiss: () => void
}

export function Banner({ banner, onDismiss }: BannerProps) {
  if (banner === null) return null

  const tone = TONE_STYLES[banner.tone]
  const Icon = tone.icon

  return (
    <div
      className={cn('border-b border-line', tone.surface)}
      role={banner.tone === 'info' ? 'status' : 'alert'}
    >
      <div className="mx-auto flex max-w-[1400px] items-start gap-3 px-4 py-3 sm:px-8">
        <Icon
          className={cn('mt-0.5 size-4 shrink-0', tone.iconClass)}
          strokeWidth={2}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{banner.title}</p>
          <p className="mt-0.5 text-sm leading-5 text-ink-2">
            {banner.message}
          </p>
        </div>
        {banner.action ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={banner.action}
          >
            {banner.actionLabel ?? 'Retry'}
          </Button>
        ) : null}
        <IconButton
          label="Dismiss message"
          icon={<X className="size-4" />}
          onClick={onDismiss}
          className="size-8 shrink-0"
        />
      </div>
    </div>
  )
}
