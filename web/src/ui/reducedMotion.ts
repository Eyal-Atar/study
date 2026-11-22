// The one reduced-motion check of the entrances (ArchiLead, the onboarding steps, the ready card).
// Each reads it once, when it arrives: the entrance happens only then. Archie's own animation
// follows the setting live and keeps its own subscription.
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
}
