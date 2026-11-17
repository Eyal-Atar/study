import { he } from '../i18n/he'
import { ButtonLink } from '../ui/ButtonLink'
import { StandalonePage } from '../ui/PageContainer'
import { PageHeader } from '../ui/PageHeader'

const t = he.settings.goodbye

// /goodbye, outside RequireAuth: where a deleted account lands, already signed out.
export function GoodbyePage() {
  return (
    <StandalonePage>
      <div className="space-y-section">
        <PageHeader title={t.title} />
        <p className="max-w-prose text-body text-ink-muted">{t.body}</p>
        <ButtonLink to="/login" variant="primary" className="w-full md:w-auto">
          {t.login}
        </ButtonLink>
      </div>
    </StandalonePage>
  )
}
