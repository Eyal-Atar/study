import { useMemo, useState, type ReactNode } from 'react'
import { PushContext, type KnownSubscription, type PushState } from './pushContext'

// Holds the VAPID public key from the environment (main.tsx reads it) and the push state of this page load.
export function PushProvider({ vapidPublicKey, children }: { vapidPublicKey: string | null; children: ReactNode }) {
  const [known] = useState(() => new Map<string, KnownSubscription>())
  const [synced] = useState(() => new Set<string>())
  const value = useMemo<PushState>(() => ({ vapidPublicKey, known, synced }), [vapidPublicKey, known, synced])
  return <PushContext value={value}>{children}</PushContext>
}
