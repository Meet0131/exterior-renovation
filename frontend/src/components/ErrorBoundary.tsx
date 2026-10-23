import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Brand } from './Brand'
import { Button } from './ui/Button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="grid min-h-screen place-items-center bg-paper px-4 py-12 text-ink">
          <div className="w-full max-w-md">
            <Brand />
            <div className="mt-10 border-t border-line pt-8">
              <h1 className="display text-3xl font-bold tracking-tight">
                Something went wrong.
              </h1>
              <p className="mt-3 text-sm leading-6 text-muted">
                The workspace hit an unexpected error. Reload the page to
                continue; the project link still holds your work.
              </p>
              <div className="mt-6">
                <Button
                  onClick={() => {
                    window.location.reload()
                  }}
                >
                  Reload the page
                </Button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
