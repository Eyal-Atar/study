import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useRouteError } from 'react-router'
import { he } from '../i18n/he'

// The message shown instead of a white page. Plain elements and inline classes only: it may render
// when a provider (React Aria, the query client, auth) is what failed, so it depends on none of them.
export function CrashScreen({ error }: { error: unknown }) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center" role="alert">
      <h1 className="text-2xl font-bold">{he.crash.title}</h1>
      <p className="mt-2 text-ink-muted">{he.crash.body}</p>
      <button
        type="button"
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 py-2 font-medium text-on-brand outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        onClick={() => {
          window.location.reload()
        }}
      >
        {he.crash.reload}
      </button>
      {/* The error's own text: what a screenshot sent to support needs. Never markup. */}
      <details className="mt-8 text-start text-sm text-ink-muted">
        <summary>{he.crash.details}</summary>
        <p dir="ltr" className="mt-2 break-words font-mono text-xs">
          {detail}
        </p>
      </details>
    </main>
  )
}

// Wraps the whole app in main.tsx, above every provider: without it, an error thrown while rendering
// unmounts the whole tree (React 19) and leaves a white page (S16, the iPhone report of 2026-11-17).
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error: error ?? new Error('unknown error') }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The console is the only log the web has until monitoring arrives (S21).
    console.error('app crashed', error, info.componentStack)
  }

  render() {
    return this.state.error === null ? this.props.children : <CrashScreen error={this.state.error} />
  }
}

// The router catches an error thrown inside a screen itself, and would show its own English page:
// the root route's ErrorBoundary shows the same Hebrew screen instead.
export function RouteCrash() {
  return <CrashScreen error={useRouteError()} />
}
