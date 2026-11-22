// The moment a block was marked done and earned XP (S32): the calendar plays its reward once.
//
// An event and not state: the moment happens once, and a refetch of the cache must never play it
// again. The listeners live at the module level, with no tie to React; a component subscribes in an
// effect and returns the unsubscribe as its cleanup.

export interface CompletedEvent {
  blockId: string
  xp: number
}

type Listener = (event: CompletedEvent) => void

const listeners = new Set<Listener>()

export function emitCompleted(event: CompletedEvent): void {
  // A copy: a listener may unsubscribe (itself or another) while the event runs.
  for (const listener of [...listeners]) {
    if (!listeners.has(listener)) continue
    try {
      listener(event)
    } catch (error) {
      // A broken listener must not break the action that emitted (complete's onSuccess would fail
      // and roll the block back); the error still surfaces, outside the action.
      setTimeout(() => {
        throw error
      }, 0)
    }
  }
}

export function onCompleted(listener: Listener): () => void {
  // A wrapper per subscription, so the same function subscribed twice is two subscriptions.
  const entry: Listener = (event) => {
    listener(event)
  }
  listeners.add(entry)
  return () => {
    listeners.delete(entry)
  }
}
