import { he } from '../i18n/he'
import { NotificationSettings } from './NotificationSettings'

// /settings/notifications: the reminder settings on their own, until S15's settings screen hosts them.
export function NotificationsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{he.notifications.title}</h1>
        <p className="text-ink-muted">{he.notifications.intro}</p>
      </div>
      <NotificationSettings />
    </div>
  )
}
