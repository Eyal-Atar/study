import { Archie } from '../archie/Archie'
import { en } from '../i18n/en'
import { ButtonLink } from '../ui/ButtonLink'
import { StandalonePage } from '../ui/PageContainer'
import { PageHeader } from '../ui/PageHeader'

const t = en.settings.goodbye

// /goodbye, outside RequireAuth: where a deleted account lands, already signed out.
export function GoodbyePage() {
  return (
    <StandalonePage>
      <div className="space-y-section">
        <div className="mx-auto w-full max-w-xs">
          <Archie mood="joy" size="scene" eager />
        </div>
        <PageHeader title={t.title} />
        <p className="max-w-prose text-body text-ink-muted">{t.body}</p>
        <ButtonLink to="/login" variant="primary" className="w-full md:w-auto">
          {t.login}
        </ButtonLink>
      </div>
    </StandalonePage>
  )
}
