import { Navigate, useLocation } from 'react-router'

// Not imported from routes.tsx, which imports this file.
const CALENDAR_PATH = '/calendar'

// S31: /today and /week were the first two destinations, and the calendar took both. Notifications
// that were already sent (S16: a notification opens /today?…), the installed app (manifest.start_url
// stays /today, since changing it would make the installed app another app) and old bookmarks still
// open them. The redirect replaces the entry, so back does not land on it again, and useRouteFocus
// leaves the focus alone on a REPLACE.

// /today?x → /calendar?x: the query passes as it is.
export function TodayRedirect() {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: CALENDAR_PATH, search, hash }} replace />
}

// /week?from=X → /calendar?view=week&from=X: view comes first, the rest of the query follows.
export function WeekRedirect() {
  const { search, hash } = useLocation()
  const params = new URLSearchParams([['view', 'week']])
  for (const [key, value] of new URLSearchParams(search)) if (key !== 'view') params.append(key, value)
  return <Navigate to={{ pathname: CALENDAR_PATH, search: `?${params.toString()}`, hash }} replace />
}
