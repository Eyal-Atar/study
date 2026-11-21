import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useRouteError } from 'react-router'
import { en } from '../i18n/en'
import { StandalonePage } from '../ui/PageContainer'
import { BUTTON_BASE, BUTTON_REST, cx, FOCUS_RING_NATIVE } from '../ui/styles'

// The message shown instead of a white page. A native <button> with the Button's classes, and no
// other ui/ component: it may render when a provider (React Aria, the query client, auth) is what
// failed, so it depends on none of them.
export function CrashScreen({ error }: { error: unknown }) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return (
    <StandalonePage>
      <div role="alert" className="text-center">
        <h1 className="text-title font-semibold">{en.crash.title}</h1>
        <p className="mt-2 text-ink-muted">{en.crash.body}</p>
        <button
          type="button"
          className={cx('mt-6', BUTTON_BASE, BUTTON_REST.primary, 'hover:bg-brand-strong active:bg-brand-strong', FOCUS_RING_NATIVE)}
          onClick={() => {
            window.location.reload()
          }}
        >
          {en.crash.reload}
        </button>
        {/* The error's own text: what a screenshot sent to support needs. Never markup. */}
        <details className="mt-8 text-start text-small text-ink-muted">
          <summary className="cursor-pointer">{en.crash.details}</summary>
          <p dir="ltr" className="mt-2 font-mono text-caption break-words">
            {detail}
          </p>
        </details>
      </div>
    </StandalonePage>
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
