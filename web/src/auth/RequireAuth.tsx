import { Navigate, Outlet } from 'react-router'
import { he } from '../i18n/he'
import { useAuth } from './AuthContext'

// The layout route of every screen that needs a signed-in user.
export function RequireAuth() {
  const auth = useAuth()
  if (auth.status === 'loading') {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <p role="status" className="text-slate-600">
          {he.common.loading}
        </p>
      </main>
    )
  }
  if (auth.status === 'signed_out') return <Navigate to="/login" replace />
  return <Outlet />
}
