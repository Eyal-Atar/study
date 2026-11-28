import { useAuth } from '../auth/AuthContext'
import { useOnline } from './online'

// The one condition the UI checks before offering a write: no network, or no session yet to call the
// API with (offline mode lasts until the token is refreshed, even after the network is back).
export function useReadOnly(): boolean {
  const online = useOnline()
  const auth = useAuth()
  return !online || auth.status === 'offline'
}
