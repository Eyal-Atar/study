import { en } from '../i18n/en'
import { StandalonePage } from '../ui/PageContainer'
import { PageHeader } from '../ui/PageHeader'
import { TextLink } from '../ui/TextLink'

const TITLES = { terms: en.entry.legal.terms, privacy: en.entry.legal.privacy } as const

// /terms and /privacy (decision 17), outside RequireAuth: the login screen links here before
// anyone has signed in. A placeholder until the documents themselves arrive in S21.
export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  return (
    <StandalonePage>
      <div className="space-y-section">
        <PageHeader title={TITLES[kind]} />
        <div>
          <p className="max-w-prose text-body text-ink-muted">{en.entry.legal.soon}</p>
          {/* The link stands alone, so it takes a 44px target (TextLink). */}
          <TextLink to="/login" className="mt-2 inline-flex min-h-touch items-center">
            {en.entry.legal.back}
          </TextLink>
        </div>
      </div>
    </StandalonePage>
  )
}
