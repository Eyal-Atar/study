import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { NOTIFICATIONS_PATH } from './paths'
import { pushSupport } from './push'

export const INSTALL_HINT_KEY = 'studyflow.installHintSeen'

// Storage can throw (Safari private mode, blocked site data). Then the hint counts as not seen and
// is shown, which is the harmless side.
function wasSeen(): boolean {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) !== null
  } catch {
    return false
  }
}

function markSeen() {
  try {
    localStorage.setItem(INSTALL_HINT_KEY, new Date().toISOString())
  } catch {
    // Nothing to do: it may be shown again on the next load.
  }
}

// Decision 17: in iOS Safari, reminders need the app on the home screen, which most users would never
// guess. Shown once per device (marked when first shown, not when dismissed, so it never nags).
export function InstallHint() {
  const titleId = useId()
  const [visible, setVisible] = useState(() => pushSupport() === 'ios_not_installed' && !wasSeen())

  useEffect(() => {
    if (visible) markSeen()
  }, [visible])

  if (!visible) return null
  const hide = () => {
    setVisible(false)
  }
  return (
    <section aria-labelledby={titleId} className="mb-6 space-y-3 rounded-xl border border-brand bg-brand-soft p-4">
      <div className="space-y-1">
        <h2 id={titleId} className="font-bold text-brand-strong">
          {he.notifications.installTitle}
        </h2>
        <p className="text-sm text-ink">{he.notifications.installText}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={NOTIFICATIONS_PATH}
          onClick={hide}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand outline-none hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          {he.notifications.installHow}
        </Link>
        <Button variant="quiet" onPress={hide}>
          {he.notifications.installDismiss}
        </Button>
      </div>
    </section>
  )
}
