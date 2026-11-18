import { useEffect, useState } from 'react'
import { NavigationType, useLocation, useNavigationType, useSearchParams } from 'react-router'
import { he } from '../i18n/he'
import { TodayPage } from '../pages/TodayPage'
import { SegmentedControl } from '../ui/SegmentedControl'
import { WeekPage } from '../week/WeekPage'
import { DAY_CHOSEN, dayChosen } from './calendarState'

type CalendarView = 'day' | 'week'

const VIEWS: readonly { id: CalendarView; label: string }[] = [
  { id: 'day', label: he.calendar.day },
  { id: 'week', label: he.calendar.week },
]

// The query of the week: view=week first, then the rest as it was.
function weekParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams([['view', 'week']])
  for (const [key, value] of params) if (key !== 'view') next.append(key, value)
  return next
}

// /calendar, temporary (S31): the home of the app until S32 replaces this whole file with the
// calendar itself. It keeps both existing screens alive: a switch "יום / שבוע" and under it the
// today screen, or the week screen with ?view=week. Without view, and with any other value, it is
// the day. The view lives in the URL, so back, forward and a shared link keep it, and a change of
// the query alone does not move the focus (useRouteFocus), so the focus stays on the switch.
//
// The week screen moves through ?from= and knows nothing about ?view=: its buttons write ?from=X,
// or nothing for "this week", and drop view. So a forward move (PUSH) that loses view while the
// week is on screen keeps the week, and view=week is put back into the address in place (REPLACE).
// The day the switch asks for, and the one "יומן" in the navigation asks for, are told apart by
// their history state (calendarState.ts); back and forward (POP) are taken as they are.
export function CalendarPage() {
  const [params, setParams] = useSearchParams()
  const state: unknown = useLocation().state
  const navigationType = useNavigationType()
  // The view of the last render. State and not a ref, since the view is decided from it during
  // render; it is set during render too, the way React keeps a value of the previous render.
  const [shown, setShown] = useState<CalendarView | null>(null)

  const raw = params.get('view')
  let view: CalendarView
  let restoreWeek = false
  if (raw === 'week') view = 'week'
  else if (raw !== null) view = 'day'
  else if (params.has('from') || (shown === 'week' && navigationType === NavigationType.Push && !dayChosen(state))) {
    // ?from= means something only to the week.
    view = 'week'
    restoreWeek = true
  } else view = 'day'

  if (shown !== view) setShown(view)

  useEffect(() => {
    if (restoreWeek) setParams((current) => weekParams(current), { replace: true })
  }, [restoreWeek, setParams])

  function choose(next: CalendarView) {
    if (next === 'week') {
      setParams((current) => weekParams(current))
      return
    }
    // The range of the week means nothing to the day.
    setParams(
      (current) => {
        const day = new URLSearchParams(current)
        day.delete('view')
        day.delete('from')
        return day
      },
      { state: DAY_CHOSEN },
    )
  }

  return (
    <div className="space-y-section">
      <SegmentedControl aria-label={he.calendar.view} options={VIEWS} value={view} onChange={choose} />
      {view === 'week' ? <WeekPage /> : <TodayPage />}
    </div>
  )
}
