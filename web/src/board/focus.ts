import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useLayoutEffect, type RefObject } from 'react'

// Where the focus goes after an action on a block (S18 decision 14a): to the first enabled button
// of that block's card, wherever the card is now. Complete on /today moves the block from the
// "next" card to the list, so the card the user pressed is gone, or shows another block; pin
// replaces the pressed button with its opposite. Either way the focus would fall to <body>.
//
// An action asks with requestFocus(blockId) once it settled (asking at the start would let the
// card take the request at once, while the pressed button is still there, and lose it again when
// the button is replaced); every BlockRow and NextBlock checks after each render whether the request is for its
// block, and takes it once it has an enabled button (until the pending state clears, its buttons are
// disabled) that does not already have the focus. A request no card takes expires, so a card that shows up much later does not grab the
// focus. `origin` is what had the focus when the user started the action: the focus may move only
// from there, from <body>, or from inside the card itself, never from where the user went since.
//
// The request lives next to the QueryClient (one per app, and one per test), not in a module-wide
// variable, so tests do not leak requests into each other and no provider is needed.

export const FOCUS_REQUEST_MS = 5_000

interface FocusRequest {
  blockId: string
  at: number
  // What had the focus when the action started: the pressed button, which may now belong to
  // another block (the "next" card shows the next block in the same elements).
  origin: Element | null
}

const requests = new WeakMap<QueryClient, FocusRequest>()

export function requestFocus(client: QueryClient, blockId: string, origin: Element | null = document.activeElement): void {
  requests.set(client, { blockId, at: Date.now(), origin })
}

export function useRequestFocus(): (blockId: string, origin?: Element | null) => void {
  const client = useQueryClient()
  return useCallback(
    (blockId: string, origin: Element | null = document.activeElement) => {
      requestFocus(client, blockId, origin)
    },
    [client],
  )
}

// The focus may move only if the user did not put it somewhere else since the action started.
function focusIsFree(root: HTMLElement, origin: Element | null): boolean {
  const active = document.activeElement
  return active === null || active === document.body || active === origin || root.contains(active)
}

// Call in a block's card, with a ref to the element that holds its buttons.
export function useFocusRequest(blockId: string, ref: RefObject<HTMLElement | null>): void {
  const client = useQueryClient()
  // No dependencies: the buttons can become enabled on any render (the action settles).
  useLayoutEffect(() => {
    const request = requests.get(client)
    if (request?.blockId !== blockId) return
    if (Date.now() - request.at > FOCUS_REQUEST_MS) {
      requests.delete(client)
      return
    }
    const root = ref.current
    if (root === null || !focusIsFree(root, request.origin)) return
    const target = root.querySelector<HTMLElement>('button:not([disabled])')
    // Already on it: a render from before the action landed, whose buttons are about to be
    // replaced. Keep the request for the render after.
    if (target === null || target === document.activeElement) return
    requests.delete(client)
    target.focus()
  })
}
