import { Navigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { en } from '../i18n/en'
import { ButtonLink } from '../ui/ButtonLink'
import { StandalonePage } from '../ui/PageContainer'
import { PageHeader } from '../ui/PageHeader'
import { ErrorState, LoadingState } from '../ui/states'

// Supabase sends the browser here after Google. supabase-js sees ?code=, exchanges it for a session
// with the verifier it kept in this browser, and removes it from the URL; this page only waits.
export function AuthCallbackPage() {
  const auth = useAuth()
  const [searchParams] = useSearchParams()

  // ?error= when the user cancelled at Google or Supabase refused. signed_out when no session came
  // out of the code: it expired, was used already, or was opened in another browser.
  const failed = searchParams.has('error') || searchParams.has('error_description') || auth.status === 'signed_out'

  if (!failed && auth.status === 'signed_in') return <Navigate to="/" replace />
  return (
    <StandalonePage>
      <div className="space-y-section">
        <PageHeader title={en.callback.title} />
        {failed ? (
          <>
            {/* No retry here: the code in the URL is spent, so trying again starts at the login screen. */}
            <ErrorState message={en.callback.failed} />
            <ButtonLink to="/login" variant="primary" className="w-full md:w-auto">
              {en.callback.backToLogin}
            </ButtonLink>
          </>
        ) : (
          <LoadingState shape="text" rows={2} label={en.callback.working} />
        )}
      </div>
    </StandalonePage>
  )
}
