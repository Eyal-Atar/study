import { Archie } from '../archie/Archie'
import { en } from '../i18n/en'
import { StandalonePage } from '../ui/PageContainer'
import { PageHeader } from '../ui/PageHeader'
import { TextLink } from '../ui/TextLink'

export function NotFoundPage() {
  return (
    <StandalonePage>
      <div className="space-y-section">
        <div className="mx-auto w-full max-w-xs">
          <Archie mood="flow" size="scene" eager />
        </div>
        <PageHeader title={en.notFound.title} />
        <div>
          <p className="max-w-prose text-body text-ink-muted">{en.notFound.body}</p>
          {/* The link stands alone, so it takes a 44px target (TextLink). */}
          <TextLink to="/" className="mt-2 inline-flex min-h-touch items-center">
            {en.notFound.backHome}
          </TextLink>
        </div>
      </div>
    </StandalonePage>
  )
}
