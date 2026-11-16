import { useMe } from '../api/me'
import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'

// A placeholder until S14 builds the today screen: the signed-in user, as the API (GET /me) knows them.
export function TodayPage() {
  const me = useMe()
  return (
    <div>
      <h1 className="text-2xl font-bold">{he.today.title}</h1>
      <p className="mt-2 text-ink-muted">{he.today.placeholder}</p>
      {me.isPending ? (
        <p role="status" className="mt-8">
          {he.common.loading}
        </p>
      ) : null}
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
          <p>{me.data.email === null ? he.today.noEmail : he.today.signedInAs(me.data.email)}</p>
          <dl className="mt-2 text-sm text-ink-muted">
            <dt>{he.today.userId}</dt>
            <dd dir="ltr">{me.data.id}</dd>
          </dl>
        </div>
      ) : null}
    </div>
  )
}
