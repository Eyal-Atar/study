// In its own file so InstallHint (rendered by AppShell) can link here without importing routes.tsx,
// which imports AppShell: a cycle. routes.tsx re-exports it.
// Until S15's settings screen is merged, the reminder settings have their own route (S16 decision 18).
export const NOTIFICATIONS_PATH = '/settings/notifications'
