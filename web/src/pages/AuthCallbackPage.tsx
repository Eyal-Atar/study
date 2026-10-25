import { Link, Navigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { he } from '../i18n/he'

// Supabase sends the browser here after Google. supabase-js sees ?code=, exchanges it for a session
// with the verifier it kept in this browser, and removes it from the URL; this page only waits.
export function AuthCallbackPage() {
  const auth = useAuth()
  const [searchParams] = useSearchParams()

  // ?error= when the user cancelled at Google or Supabase refused. signed_out when no session came
  // out of the code: it expired, was used already, or was opened in another browser.
  const failed = searchParams.has('error') || searchParams.has('error_description') || auth.status === 'signed_out'

  if (failed) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p role="alert" className="text-red-700">
          {he.callback.failed}
        </p>
        <Link to="/login" className="mt-6 inline-block font-medium underline">
          {he.callback.backToLogin}
        </Link>
      </main>
    )
  }
  if (auth.status === 'signed_in') return <Navigate to="/" replace />
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <p role="status" className="text-slate-600">
        {he.callback.working}
      </p>
    </main>
  )
}
