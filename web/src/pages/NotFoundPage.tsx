import { Link } from 'react-router'
import { he } from '../i18n/he'

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold">{he.notFound.title}</h1>
      <Link to="/" className="mt-6 inline-block font-medium underline">
        {he.notFound.backHome}
      </Link>
    </main>
  )
}
