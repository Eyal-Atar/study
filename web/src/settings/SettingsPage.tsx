import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { errorMessage } from '../api/client'
import { useMe, type Me } from '../api/me'
import { DELETE_ACCOUNT_PATH } from '../app/routes'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { ExportSection } from './ExportSection'
import { PreferencesForm } from './PreferencesForm'
import { NotificationSettings } from '../notifications/NotificationSettings'

const t = he.settings

// The id DeleteAccountPage links to ("export first").
export const EXPORT_SECTION_ID = 'export'

function Section({
  title,
  intro,
  id,
  tone = 'plain',
  children,
}: {
  title: string
  intro?: string
  id?: string
  tone?: 'plain' | 'danger'
  children?: ReactNode
}) {
  const headingId = useId()
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`flex scroll-mt-4 flex-col gap-4 rounded-xl border p-4 ${
        tone === 'danger' ? 'border-line bg-danger-soft' : 'border-line bg-surface'
      }`}
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className={`text-lg font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>
          {title}
        </h2>
        {intro === undefined ? null : <p className="text-sm text-ink-muted">{intro}</p>}
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
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">{t.title}</h1>

      <Section title={t.preferences.title} intro={t.preferences.intro}>
        {me.isPending ? (
          <p role="status" className="text-ink-muted">
            {he.common.loading}
          </p>
        ) : me.isError ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-danger">
              {errorMessage(me.error)}
            </p>
            <Button
              variant="secondary"
              onPress={() => {
                void me.refetch()
              }}
            >
              {he.common.retry}
            </Button>
          </div>
        ) : (
          // A profile changed elsewhere remounts the form with its values (unsaved edits drop).
          <PreferencesForm key={preferencesKey(me.data)} me={me.data} />
        )}
      </Section>

      {/* S16: reminders on this device and the lead time; the component brings its own card. */}
      <NotificationSettings />

      <Section id={EXPORT_SECTION_ID} title={t.export.title}>
        <ExportSection />
      </Section>

      <Section title={t.danger.title} intro={t.danger.description} tone="danger">
        <Link
          to={DELETE_ACCOUNT_PATH}
          className="inline-flex min-h-11 items-center justify-center self-start rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-danger outline-none hover:bg-danger-soft focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          {t.danger.link}
        </Link>
      </Section>
    </div>
  )
}
