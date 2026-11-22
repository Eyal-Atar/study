import { Link } from 'react-router'
import { errorMessage } from '../api/client'
import { useMe, type Me } from '../api/me'
import { DELETE_ACCOUNT_PATH } from '../app/routes'
import { en } from '../i18n/en'
import { Card } from '../ui/Card'
import { ChevronRight, Trash2 } from '../ui/icons'
import { PageHeader } from '../ui/PageHeader'
import { ErrorState, LoadingState } from '../ui/states'
import { cx, FOCUS_RING, ICON_STROKE } from '../ui/styles'
import { CommitmentsSection } from './CommitmentsSection'
import { ExportSection } from './ExportSection'
import { PreferencesForm } from './PreferencesForm'
import { NotificationSettings } from '../notifications/NotificationSettings'

const t = en.settings

// The id DeleteAccountPage links to ("export first").
export const EXPORT_SECTION_ID = 'export'

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

// /settings (spec 7.9, S34 decision 15): the study preferences with their Save, then Busy time,
// Reminders (S16), and the account card with the export and the deletion.
export function SettingsPage() {
  const me = useMe()
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t.title} />

      {me.isPending ? (
        <Card role="region" title={t.preferences.title}>
          <LoadingState shape="text" rows={4} />
        </Card>
      ) : me.isError ? (
        <Card role="region" title={t.preferences.title}>
          <ErrorState
            message={errorMessage(me.error)}
            onRetry={() => {
              void me.refetch()
            }}
          />
        </Card>
      ) : (
        // A profile changed elsewhere remounts the form with its values (unsaved edits drop).
        <PreferencesForm key={preferencesKey(me.data)} me={me.data} />
      )}

      {/* Busy time after the preferences and their Save, since it saves at once. */}
      <CommitmentsSection />

      {/* S16: reminders on this device and the lead time, in this one card. */}
      <Card role="region" title={en.notifications.title}>
        <p className="mb-4 max-w-prose text-small text-ink-muted">{en.notifications.intro}</p>
        <NotificationSettings variant="bare" />
      </Card>

      <Card role="region" title={en.settingsScreen.prefs.accountTitle}>
        <div className="flex flex-col divide-y divide-line">
          <div id={EXPORT_SECTION_ID} className="scroll-mt-4 pb-4">
            <ExportSection />
          </div>
          <div className="flex flex-col gap-1 pt-4">
            <Link
              to={DELETE_ACCOUNT_PATH}
              className={cx(
                'flex min-h-touch items-center gap-3 rounded-control text-body font-semibold text-danger',
                'hover:bg-surface-muted motion-safe:transition-colors motion-safe:duration-(--duration-fast)',
                FOCUS_RING,
              )}
            >
              <Trash2 aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="shrink-0" />
              <span className="min-w-0 flex-1">{t.danger.link}</span>
              <ChevronRight aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className="shrink-0" />
            </Link>
            <p className="max-w-prose text-small text-ink-muted">{t.danger.description}</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
