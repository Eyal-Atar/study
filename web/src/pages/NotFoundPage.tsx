import { he } from '../i18n/he'
import { TextLink } from '../ui/TextLink'

export function NotFoundPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-display font-semibold">{he.notFound.title}</h1>
      <TextLink to="/" className="mt-6 inline-flex min-h-touch items-center">
        {he.notFound.backHome}
      </TextLink>
    </main>
  )
}
