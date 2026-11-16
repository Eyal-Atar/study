import { Link } from 'react-router'
import { he } from '../i18n/he'

const t = he.settings.goodbye

// /goodbye, outside RequireAuth: where a deleted account lands, already signed out.
export function GoodbyePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-bold text-ink">{t.title}</h1>
      <p className="text-ink-muted">{t.body}</p>
      <Link
        to="/login"
        className="inline-flex min-h-11 items-center justify-center self-start rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand outline-none hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        {t.login}
      </Link>
    </main>
  )
}
