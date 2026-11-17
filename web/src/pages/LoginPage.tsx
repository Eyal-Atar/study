import { useState } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { StandalonePage } from '../ui/PageContainer'

// The first impression of the product: the name, one sentence that says what you get, and one
// button. Aligned to the start like every screen inside, so it already reads as the same page.
export function LoginPage() {
  const auth = useAuth()
  const [failed, setFailed] = useState(false)
  const [isPending, setIsPending] = useState(false)

  if (auth.status === 'signed_in') return <Navigate to="/" replace />

  return (
    <StandalonePage>
      {/* Written here and not with PageHeader, which would name the tab "StudyFlow · StudyFlow". */}
      <h1 className="text-display font-semibold break-words text-ink">{he.appName}</h1>
      <p className="mt-3 max-w-prose text-body text-ink-muted">{he.tagline}</p>
      {/* Full width on a phone, where the thumb is; the width of its text from md. */}
      <div className="mt-10 flex flex-col gap-3 md:items-start">
        <Button
          isPending={isPending}
          onPress={() => {
            setFailed(false)
            setIsPending(true)
            // On success the browser leaves for Google, and comes back to AUTH_CALLBACK_PATH.
            // The button is released then too: a page that the browser restores on "back" must
            // not come back with a button that is still waiting.
            auth
              .signInWithGoogle()
              .catch(() => {
                setFailed(true)
              })
              .finally(() => {
                setIsPending(false)
              })
          }}
        >
          {he.login.google}
        </Button>
        {failed && (
          <p role="alert" className="text-small text-danger">
            {he.login.failed}
          </p>
        )}
      </div>
    </StandalonePage>
  )
}
