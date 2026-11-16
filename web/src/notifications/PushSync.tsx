import { useEffect } from 'react'
import { useUserId } from '../api/me'
import { useRegisterSubscription } from './api'
import { currentSubscription, pushSupport, toSubscriptionBody } from './push'
import { usePushState } from './pushContext'

// Sends this browser's subscription again on every load (once per user), because the server may
// have deleted its row (a 410 from the push service) and iOS sometimes changes the endpoint, and the
// service worker cannot call the API itself (it has no token). The answer's id is what "כיבוי" deletes.
// Silent: a failure here changes nothing the user can act on. Renders nothing.
export function PushSync() {
  const userId = useUserId()
  const { synced } = usePushState()
  const { mutateAsync: register } = useRegisterSubscription()

  useEffect(() => {
    if (userId === null || synced.has(userId)) return
    // Marked before the async work, so StrictMode's second effect run does not send it twice.
    synced.add(userId)
    if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return
    void (async () => {
      const sub = await currentSubscription()
      if (sub === null) return
      await register(toSubscriptionBody(sub))
    })().catch(() => undefined)
  }, [userId, synced, register])

  return null
}
