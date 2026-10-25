import { useState } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'

export function LoginPage() {
  const auth = useAuth()
  const [failed, setFailed] = useState(false)

  if (auth.status === 'signed_in') return <Navigate to="/" replace />

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-3xl font-bold">{he.appName}</h1>
      <p className="mt-2 text-slate-600">{he.tagline}</p>
      <Button
        className="mt-8"
        onPress={() => {
          setFailed(false)
          // On success the browser leaves for Google, and comes back to AUTH_CALLBACK_PATH.
          auth.signInWithGoogle().catch(() => {
            setFailed(true)
          })
        }}
      >
        {he.login.google}
      </Button>
      {failed && (
        <p role="alert" className="mt-4 text-red-700">
          {he.login.failed}
        </p>
      )}
    </main>
  )
}
