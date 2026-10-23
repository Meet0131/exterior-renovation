import { AppShell } from './components/AppShell'
import { Brand } from './components/Brand'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Button } from './components/ui/Button'
import { Spinner } from './components/ui/Spinner'
import { RegionsScreen } from './screens/RegionsScreen'
import { FinishesScreen } from './screens/FinishesScreen'
import { EstimateScreen } from './screens/EstimateScreen'
import { ReportScreen } from './screens/ReportScreen'
import { StartScreen } from './screens/StartScreen'
import { UploadScreen } from './screens/UploadScreen'
import type { Step } from './lib/steps'
import { WorkspaceProvider } from './state/WorkspaceProvider'
import { useWorkspace } from './state/useWorkspace'

function FullPageLoading() {
  return (
    <div
      className="grid min-h-screen place-items-center bg-paper px-4 text-ink"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-5 text-center">
        <Brand />
        <Spinner className="size-5 text-pine" />
        <p className="text-sm text-muted">Opening your project…</p>
      </div>
    </div>
  )
}

function LoadErrorScreen() {
  const { loadError, retryLoad, startOver } = useWorkspace()

  if (loadError === null) return null

  const invalid = loadError.kind === 'invalid-link'
  const network = loadError.kind === 'network'
  const heading = invalid
    ? 'This project link is not valid.'
    : network
      ? "Can't reach the server."
      : 'This project did not open.'

  return (
    <div className="grid min-h-screen place-items-center bg-paper px-4 py-12 text-ink">
      <div className="w-full max-w-lg">
        <Brand />
        <div className="mt-10 border-t border-line pt-8">
          <h1 className="display text-4xl font-bold leading-[1.02] tracking-[-0.04em] text-balance">
            {heading}
          </h1>
          <p className="mt-3 max-w-[52ch] text-sm leading-6 text-muted">
            {loadError.message}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {!invalid ? (
              <Button
                onClick={() => {
                  void retryLoad()
                }}
              >
                Retry
              </Button>
            ) : null}
            <Button
              variant={invalid ? 'primary' : 'outline'}
              onClick={startOver}
            >
              Start a new project
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function WorkspaceScreen({ step }: { step: Step }) {
  const { activeImage } = useWorkspace()
  const imageKey = activeImage?.id ?? 'none'

  switch (step) {
    case 'upload':
      return <UploadScreen />
    case 'regions':
      return <RegionsScreen key={imageKey} />
    case 'materials':
      return <FinishesScreen />
    case 'estimate':
      return <EstimateScreen key={imageKey} />
    case 'report':
      return <ReportScreen key={imageKey} />
  }
}

function AppContent() {
  const { loading, loadError, project, step } = useWorkspace()

  if (loading) return <FullPageLoading />
  if (loadError !== null) return <LoadErrorScreen />
  if (project === null) return <StartScreen />

  return (
    <AppShell>
      <WorkspaceScreen step={step} />
    </AppShell>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <WorkspaceProvider>
        <AppContent />
      </WorkspaceProvider>
    </ErrorBoundary>
  )
}

export default App
