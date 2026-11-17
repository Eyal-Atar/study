import { Navigate, Outlet } from 'react-router'
import { StandalonePage } from '../ui/PageContainer'
import { LoadingState } from '../ui/states'
import { useAuth } from './AuthContext'

// The layout route of every screen that needs a signed-in user.
export function RequireAuth() {
  const auth = useAuth()
  if (auth.status === 'loading') {
    // Before the session is known there is no shell and no screen yet: one card in the column
    // where the screen will be.
    return (
      <StandalonePage>
        <LoadingState shape="card" />
      </StandalonePage>
    )
  }
  if (auth.status === 'signed_out') return <Navigate to="/login" replace />
  return <Outlet />
}
