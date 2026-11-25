import type { BloomEvent } from './types'

// The seam of S33, the garden (decision 14): an exam closed as done bloomed.
//
// Nothing in S45 listens. S33 connects in two places: (a) a listener on onBloom plays the bloom (the
// celebration of a stage in the garden, up to a second and a half, closed by a tap); (b) the garden reads
// progress.archive as the source of truth for the blooming plants, so Undo (which takes the exam out of
// the archive) removes the bloom with no reverse event.
//
// An event and not state: a refetch must never play it again (like board/xpEvents.ts). The listeners
// live at the module level, with no tie to React; a component subscribes in an effect and returns the
// unsubscribe as its cleanup.

type Listener = (event: BloomEvent) => void

const listeners = new Set<Listener>()

export function emitBloom(event: BloomEvent): void {
  // A copy: a listener may unsubscribe (itself or another) while the event runs.
  for (const listener of [...listeners]) {
    if (!listeners.has(listener)) continue
    try {
      listener(event)
    } catch (error) {
      // A broken listener must not break the action that emitted; the error still surfaces, outside it.
      setTimeout(() => {
        throw error
      }, 0)
    }
  }
}

export function onBloom(listener: Listener): () => void {
  // A wrapper per subscription, so the same function subscribed twice is two subscriptions.
  const entry: Listener = (event) => {
    listener(event)
  }
  listeners.add(entry)
  return () => {
    listeners.delete(entry)
  }
}
