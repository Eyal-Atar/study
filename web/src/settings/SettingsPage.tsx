import { useId, type ReactNode } from 'react'
import { errorMessage } from '../api/client'
import { useMe, type Me } from '../api/me'
import { DELETE_ACCOUNT_PATH } from '../app/routes'
import { he } from '../i18n/he'
import { ButtonLink } from '../ui/ButtonLink'
import { Card } from '../ui/Card'
import { PageHeader } from '../ui/PageHeader'
import { SectionHeading } from '../ui/SectionHeading'
import { ErrorState, LoadingState } from '../ui/states'
import { ExportSection } from './ExportSection'
import { PreferencesForm } from './PreferencesForm'
import { NotificationSettings } from '../notifications/NotificationSettings'

const t = he.settings

// The id DeleteAccountPage links to ("export first").
export const EXPORT_SECTION_ID = 'export'

// A section of the screen: a quiet heading over plain content, set apart from the section above it
// by a thin line and air. No card: the only card of this screen is the danger zone.
function Section({ title, intro, id, children }: { title: string; intro?: string; id?: string; children?: ReactNode }) {
  const headingId = useId()
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="flex scroll-mt-4 flex-col gap-4 border-t border-line pt-6 first-of-type:border-t-0 first-of-type:pt-0"
    >
      <div className="flex flex-col gap-1">
        <SectionHeading id={headingId}>{title}</SectionHeading>
        {intro === undefined ? null : <p className="max-w-prose text-small text-ink-muted">{intro}</p>}
      </div>
      {children}
    </section>
  )
}

// The preference values PreferencesForm edits: a change in any of them remounts it.
function preferencesKey(me: Me): string {
  return JSON.stringify([
    me.daily_study_minutes,
    me.study_windows,
    me.wake_time,
    me.sleep_time,
    me.study_start_delay_minutes,
    me.hobby_start,
    me.hobby_minutes,
    me.rest_days_before_exam,
  ])
}

// /settings (spec 7.9): preferences, notifications (S16), export and account deletion.
export function SettingsPage() {
  const me = useMe()
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.title} />

      <Section title={t.preferences.title} intro={t.preferences.intro}>
        {me.isPending ? (
          <LoadingState shape="text" rows={4} />
        ) : me.isError ? (
          <ErrorState
            message={errorMessage(me.error)}
            onRetry={() => {
              void me.refetch()
            }}
          />
        ) : (
          // A profile changed elsewhere remounts the form with its values (unsaved edits drop).
          <PreferencesForm key={preferencesKey(me.data)} me={me.data} />
        )}
      </Section>

      {/* S16: reminders on this device and the lead time. The component draws its own two cards;
          the section gives them the heading and the line every other part of the screen has. */}
      <Section title={t.notifications.title}>
        <NotificationSettings />
      </Section>

      <Section id={EXPORT_SECTION_ID} title={t.export.title}>
        <ExportSection />
      </Section>

      {/* Last, and the only red on the screen. The text is ink: ink-muted is not a checked pair on
          danger-soft. role="region" lets the title of the card name it. */}
      <Card tone="danger" role="region" title={t.danger.title}>
        <div className="flex flex-col items-start gap-3">
          <p className="max-w-prose text-small text-ink">{t.danger.description}</p>
          <ButtonLink to={DELETE_ACCOUNT_PATH} variant="danger">
            {t.danger.link}
          </ButtonLink>
        </div>
      </Card>
    </div>
  )
}
