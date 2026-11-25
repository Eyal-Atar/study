import { useEffect, useSyncExternalStore } from 'react'
import { onCompleted, type CompletedEvent } from '../board/xpEvents'
import type { DoneEvent } from './rules'

// The celebration inbox (plan S33, decisions 2 and 15): the Done events of this session, kept
// outside React so a celebration waits for the calendar, which pulls them when no sheet is open.
// AppShell mounts useCelebrationInbox once for every signed-in screen (Focus included), so a Done
// marked in Focus is still there when the calendar opens.

// The oldest goes out past this; rules.ts drops what is older than 15 minutes anyway.
export const INBOX_LIMIT = 20

let events: DoneEvent[] = []
const listeners = new Set<() => void>()

// One subscription to onCompleted for all the hooks that hold the inbox: StrictMode's mount, cleanup
// and mount, or two screens mounted at once, never keep one Done twice.
let holders = 0
let unsubscribe: (() => void) | null = null

function notify(): void {
  for (const listener of [...listeners]) listener()
}

function keep(event: CompletedEvent): void {
  // A copy of the badges: the sender's array is not the inbox's to share.
  events = [...events, { ...event, badgesEarned: [...event.badgesEarned], at: Date.now() }].slice(-INBOX_LIMIT)
  notify()
}

function hold(): () => void {
  holders += 1
  unsubscribe ??= onCompleted(keep)
  return () => {
    holders -= 1
    if (holders === 0 && unsubscribe !== null) {
      unsubscribe()
      unsubscribe = null
    }
  }
}

export function useCelebrationInbox(): void {
  useEffect(hold, [])
}

// The events, oldest first; the inbox is empty after.
export function takeEvents(): DoneEvent[] {
  const taken = events
  if (taken.length === 0) return []
  events = []
  notify()
  return taken
}

// Signed out, or another user (auth/AuthProvider.tsx): the next user never celebrates the last one's
// Done. AppShell stays mounted across a direct switch, so the inbox cannot rely on an unmount.
export function clearInbox(): void {
  if (events.length === 0) return
  events = []
  notify()
}

export function subscribeInbox(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function size(): number {
  return events.length
}

// How many events wait, so the calendar knows there is something to pull.
export function useInboxSize(): number {
  return useSyncExternalStore(subscribeInbox, size, size)
}
