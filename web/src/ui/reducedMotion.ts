import { useSyncExternalStore } from 'react'

// The one reduced-motion check of the product's screens. An entrance (ArchiLead, the onboarding
// steps, the ready card, the XP burst of the calendar) reads it once, when it happens:
// prefersReducedMotion(). Motion that lasts (the blocks of the calendar sliding back) follows the
// setting live: useReducedMotion(). Archie's own animation keeps its own subscription.
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
}

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => {
    query.removeEventListener('change', onChange)
  }
}

// Read live: a change in the system settings stops (or allows) the motion at once. On the server
// there is no setting to read, so no motion.
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => true)
}
