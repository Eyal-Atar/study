import { useMe } from '../api/me'
import { errorMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'

// The signed-in user, as the API (GET /me) knows them.
export function HomePage() {
  const { signOut } = useAuth()
  const me = useMe()
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold">{he.appName}</h1>
      {me.isPending ? <p className="mt-8">{he.common.loading}</p> : null}
      {me.isError ? (
        <div className="mt-8">
          <p role="alert">{errorMessage(me.error)}</p>
          <Button
            className="mt-4"
            onPress={() => {
              void me.refetch()
            }}
          >
            {he.common.retry}
          </Button>
        </div>
      ) : null}
      {me.isSuccess ? (
        <div className="mt-8">
          <p>{me.data.email === null ? he.home.noEmail : he.home.signedInAs(me.data.email)}</p>
          <dl className="mt-2 text-sm text-slate-600">
            <dt>{he.home.userId}</dt>
            <dd dir="ltr">{me.data.id}</dd>
          </dl>
        </div>
      ) : null}
      <Button
        variant="secondary"
        className="mt-8"
        onPress={() => {
          void signOut()
        }}
      >
        {he.home.signOut}
      </Button>
    </main>
  )
}
