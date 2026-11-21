import { en } from '../i18n/en'
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
        <PageHeader title={en.config.title} />
        <p className="max-w-prose text-body text-ink">{en.config.body}</p>
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
