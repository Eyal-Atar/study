// The click that ends a gesture is not a press on the block (useBlockDrag, useSwipe).
//
// The guard lasts a time and not a task. With a mouse the click comes from the same input event as
// the pointerup. With touch it comes from a tap that the browser recognises after touchend (Chrome
// after the renderer acknowledged it, iOS from its tap recognizer), so it arrives in a later task:
// a guard that ended on the next task would let it through. A click alone much later, such as a
// screen reader's double tap, is a press. A new pointerdown or a key ends the guard at once.

export const CLICK_GUARD_MS = 600

export interface ClickGuard {
  // A gesture ended (or is ending): swallow a click that comes soon.
  arm: () => void
  reset: () => void
  // True once, for a click within CLICK_GUARD_MS of the last arm.
  consume: () => boolean
}

export function createClickGuard(): ClickGuard {
  let armedAt: number | null = null
  return {
    arm: () => {
      armedAt = performance.now()
    },
    reset: () => {
      armedAt = null
    },
    consume: () => {
      const at = armedAt
      armedAt = null
      return at !== null && performance.now() - at <= CLICK_GUARD_MS
    },
  }
}
