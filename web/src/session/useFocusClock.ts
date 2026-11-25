import { useEffect, useState } from 'react'
import { focusClock, type FocusClock, type FocusSession } from './focusSession'

// The longest delay setTimeout can count (2^31 - 1 ms); a longer one fires at once.
const MAX_DELAY_MS = 2_147_483_647

// The clock of the focus screen (S42). It does not count: every render computes the clock from the
// wall time (`now`), and one timeout is set for the moment the shown minute or the phase changes
// next (`nextChangeAt`), never a tick each second. A locked phone or a tab in the background runs no
// JavaScript and its timers are late, so a page that becomes visible again, or comes back from the
// back-forward cache (pageshow), takes the wall time at once (Review Focus 3).
export function useFocusClock(session: FocusSession | null): { now: number; clock: FocusClock | null } {
  const [stateNow, setNow] = useState(() => Date.now())
  // A session that arrives after the mount (the focus screen writes one once GET /today answers) was
  // started after the last `now` was taken: its own start is the wall time it arrived at. So it is
  // never drawn with the older `now`, a minute too many ("61 min"), not even for one frame, and no
  // effect has to set the state again. Pure: no clock is read in the render.
  const now = session === null ? stateNow : Math.max(stateNow, session.startedAt)
  const clock = session === null ? null : focusClock(session, now)
  const nextChangeAt = clock?.nextChangeAt ?? null
  const hasSession = session !== null

  useEffect(() => {
    if (!hasSession) return
    const refresh = () => {
      setNow(Date.now())
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', refresh)
    }
  }, [hasSession])

  // `now` is a dependency too: a timeout that fires a little early leaves nextChangeAt as it was, and
  // the next one is set from the new now. A nextChangeAt already past (a late timer) gives a delay
  // of 0, and the clock catches up. In 'over' there is nothing more to change, so no timer.
  useEffect(() => {
    if (nextChangeAt === null) return
    const delay = Math.min(Math.max(nextChangeAt - Date.now(), 0), MAX_DELAY_MS)
    const id = setTimeout(() => {
      setNow(Date.now())
    }, delay)
    return () => {
      clearTimeout(id)
    }
  }, [nextChangeAt, now])

  return { now, clock }
}
