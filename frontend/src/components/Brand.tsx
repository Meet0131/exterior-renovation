import { House } from 'lucide-react'
import { cn } from '../lib/cn'

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        className="grid size-9 place-items-center rounded-lg bg-pine-soft text-pine"
        aria-hidden="true"
      >
        <House className="size-[18px]" strokeWidth={1.8} />
      </span>
      <span className="display text-xl font-bold tracking-tight">RenoVision</span>
    </span>
  )
}
