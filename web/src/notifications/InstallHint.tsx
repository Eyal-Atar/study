import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { ButtonLink } from '../ui/ButtonLink'
import { Card } from '../ui/Card'
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
  const onSettings = useLocation().pathname === NOTIFICATIONS_PATH
  const [visible, setVisible] = useState(() => pushSupport() === 'ios_not_installed' && !wasSeen())

  useEffect(() => {
    if (visible) markSeen()
  }, [visible])

  // The settings screen explains the same steps itself, so the card steps aside there (and the link
  // to it needs no click handler).
  if (!visible || onSettings) return null
  return (
    <Card role="region" title={en.notifications.installTitle} className="mb-section">
      <p className="text-small">{en.notifications.installText}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ButtonLink to={NOTIFICATIONS_PATH} variant="primary">
          {en.notifications.installHow}
        </ButtonLink>
        <Button
          variant="quiet"
          onPress={() => {
            setVisible(false)
          }}
        >
          {en.notifications.installDismiss}
        </Button>
      </div>
    </Card>
  )
}
