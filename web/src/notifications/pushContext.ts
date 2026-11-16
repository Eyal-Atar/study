import { createContext, useContext } from 'react'

// The id the API gave this browser's subscription, with the endpoint it belongs to (an id learned
// for an older endpoint must not be used for a new one).
export interface KnownSubscription {
  id: string
  endpoint: string
}

// Push state shared by PushSync and NotificationSettings for one page load. Plain mutable
// collections, not React state: nothing renders from them, they are read when the user presses a button.
export interface PushState {
  vapidPublicKey: string | null
  // By user id, so after a switch of users one never deletes the other's row.
  known: Map<string, KnownSubscription>
  // Users whose subscription PushSync already sent in this page load.
  synced: Set<string>
}

export const PushContext = createContext<PushState | null>(null)

export function usePushState(): PushState {
  const value = useContext(PushContext)
  if (value === null) throw new Error('usePushState() must be used inside <PushProvider>')
  return value
}
