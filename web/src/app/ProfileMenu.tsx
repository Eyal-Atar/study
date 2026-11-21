import { LogOut, Settings, User } from '../ui/icons'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { en } from '../i18n/en'
import { unsubscribeThisDevice, withTimeout } from '../notifications/push'
import { IconButton } from '../ui/IconButton'
import { Menu, MenuItem } from '../ui/Menu'
import { ICON_STROKE } from '../ui/styles'

// Sign-out waits this long at most for the browser to drop its push subscription.
const UNSUBSCRIBE_TIMEOUT_MS = 3000

// Not imported from routes.tsx: routes imports AppShell, which imports this file.
const SETTINGS_PATH = '/settings'

const LETTER = /^\p{L}$/u

// The letter on the profile button: the first letter of the Google name, and when the name has
// none, of the email. null when neither starts with a letter (missing, empty, an emoji, a digit):
// the button then shows an icon. `name` is unknown because user_metadata is whatever the provider
// sent.
function profileInitial(name: unknown, email: string | undefined): string | null {
  for (const source of [name, email]) {
    if (typeof source !== 'string') continue
    // By code point, not by UTF-16 unit: half of a surrogate pair is never a letter, but it would
    // also never be the character the user wrote.
    const first = Array.from(source.trim()).at(0)
    if (first !== undefined && LETTER.test(first)) return first.toUpperCase()
  }
  return null
}

// The profile button at the end of the header, and its menu: settings and sign out. Neither is a
// destination of the navigation (design language, section 6).
export function ProfileMenu() {
  const auth = useAuth()
  const navigate = useNavigate()
  // The shell renders under RequireAuth, but the type does not know that.
  const user = auth.status === 'signed_in' ? auth.session.user : null
  const initial = user === null ? null : profileInitial(user.user_metadata.full_name, user.email)

  return (
    <Menu
      trigger={
        <IconButton aria-label={en.shell.profile} className="rounded-full">
          {/* A 36px circle inside the 44px touch target, as the prototype's .avatar. */}
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-small font-semibold text-brand-strong">
            {initial ?? <User aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />}
          </span>
        </IconButton>
      }
    >
      <MenuItem
        icon={Settings}
        onAction={() => {
          void navigate(SETTINGS_PATH)
        }}
      >
        {en.shell.settings}
      </MenuItem>
      <MenuItem
        icon={LogOut}
        onAction={() => {
          // S16 decision 9: the browser drops its push subscription first, so the next user of this
          // device does not get this user's reminders. Bounded and never blocking: a failure here
          // must not keep anyone signed in.
          void withTimeout(unsubscribeThisDevice(), UNSUBSCRIBE_TIMEOUT_MS, undefined)
            .catch(() => undefined)
            .then(() => auth.signOut())
        }}
      >
        {en.shell.signOut}
      </MenuItem>
    </Menu>
  )
}
