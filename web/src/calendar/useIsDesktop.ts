import { useSyncExternalStore } from 'react'

const QUERY = '(min-width: 1024px)'

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const list = window.matchMedia(QUERY)
  list.addEventListener('change', onChange)
  return () => {
    list.removeEventListener('change', onChange)
  }
}

function snapshot(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

// From the lg breakpoint up; without matchMedia (jsdom) false.
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
