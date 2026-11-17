import { he } from '../i18n/he'
import { StandalonePage } from '../ui/PageContainer'
import { PageHeader } from '../ui/PageHeader'
import { TextLink } from '../ui/TextLink'

export function NotFoundPage() {
  return (
    <StandalonePage>
      <div className="space-y-section">
        <PageHeader title={he.notFound.title} />
        <div>
          <p className="max-w-prose text-body text-ink-muted">{he.notFound.body}</p>
          {/* The link stands alone, so it takes a 44px target (TextLink). */}
          <TextLink to="/" className="mt-2 inline-flex min-h-touch items-center">
            {he.notFound.backHome}
          </TextLink>
        </div>
      </div>
    </StandalonePage>
  )
}
