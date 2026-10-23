import type { ReactNode } from 'react'
import { useWorkspace } from '../state/useWorkspace'
import { Banner } from './Banner'
import { PhotoStrip } from './PhotoStrip'
import { Stepper } from './Stepper'
import { Toast } from './Toast'
import { TopBar } from './TopBar'
import { Spinner } from './ui/Spinner'

export function AppShell({ children }: { children: ReactNode }) {
  const { banner, dismissBanner, toast, finalizing } = useWorkspace()

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <TopBar />
        <Stepper />
      </header>

      <Banner banner={banner} onDismiss={dismissBanner} />

      <PhotoStrip />

      <main className="mx-auto w-full max-w-[1400px] px-4 pb-24 pt-6 sm:px-8 sm:pt-8">
        {children}
      </main>

      {finalizing ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-paper/85 px-4 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-label="Rendering final image"
          aria-busy="true"
        >
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-[2px] border border-line bg-surface px-8 py-7 text-center shadow-float">
            <Spinner className="size-6 text-pine" />
            <p className="display text-lg font-semibold tracking-tight">
              Rendering final image…
            </p>
            <p className="text-sm leading-6 text-muted">
              This can take a few seconds. Keep this tab open.
            </p>
          </div>
        </div>
      ) : null}

      <Toast toast={toast} />
    </div>
  )
}
