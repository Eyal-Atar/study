import { onlineManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

// The one place that knows whether there is a network. Everything else asks onlineManager (or useOnline).
// Call once at startup, before the query client is created.
// Tests never call it: its setup re-reads navigator.onLine whenever the first subscriber comes
// back, which would overwrite a manual onlineManager.setOnline(false).
export function initOnline(): void {
  onlineManager.setEventListener((setOnline) => {
    // Read navigator.onLine right away: TanStack's default listener only reacts to events, so a page
    // opened without a network would start as "online" and its first requests would hang.
    setOnline(navigator.onLine)
    const goOnline = () => {
      setOnline(true)
    }
    const goOffline = () => {
      setOnline(false)
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  })
}

// One function for the life of the app: a new one per render would make React re-subscribe, and a
// re-subscribe with no other listener re-runs the setup above.
const subscribe = (onChange: () => void) => onlineManager.subscribe(onChange)

// The current network state, re-rendering when it changes.
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => onlineManager.isOnline())
}
