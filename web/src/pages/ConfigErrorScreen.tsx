import { he } from '../i18n/he'
import { Card } from '../ui/Card'
import { StandalonePage } from '../ui/PageContainer'
import { PageHeader } from '../ui/PageHeader'

// Shown by main.tsx instead of the app when readEnv() fails, so it renders outside the router:
// nothing here may be a router component (TextLink, ButtonLink). The problems are for the
// developer, in English, so the list is left to right.
export function ConfigErrorScreen({ problems }: { problems: readonly string[] }) {
  return (
    <StandalonePage>
      <div className="space-y-section">
        <PageHeader title={he.config.title} />
        <p className="max-w-prose text-body text-ink">{he.config.body}</p>
        <Card>
          {/* break-words: a problem holds a long URL or a variable name, with nowhere to wrap. */}
          <ul dir="ltr" className="list-disc space-y-2 ps-5 text-small break-words">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Card>
      </div>
    </StandalonePage>
  )
}
