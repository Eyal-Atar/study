// Where the reminder settings live: S15's settings screen hosts NotificationSettings. In its own
// file so InstallHint (rendered by AppShell) can link here without importing routes.tsx, which
// imports AppShell: a cycle.
export const NOTIFICATIONS_PATH = '/settings'
