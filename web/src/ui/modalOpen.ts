import { useSyncExternalStore } from 'react'

// Whether a modal Dialog is open anywhere in the app (S33 fix wave 4): the toast region reads it to
// move its stack to the top of the screen, so a toast never sits over a sheet's body. Every modal of
// the app is ui/Dialog, which holds this while it is open.

let open = 0
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** Marks a modal as open; the function it returns marks it closed again (once). */
export function holdModal(): () => void {
  open += 1
  emit()
  let released = false
  return () => {
    if (released) return
    released = true
    open -= 1
    emit()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const isOpen = () => open > 0

export function useModalOpen(): boolean {
  return useSyncExternalStore(subscribe, isOpen, isOpen)
}
