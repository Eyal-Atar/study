import { dateIn, formatTime } from '../board/time'
import { shortDate } from '../calendar/days'

// When the data on the screen was read, in words for the offline notice: the time alone when it was
// today in `tz` ('11:20'), the day too when it was not ('Sat, 21 Nov, 09:00'). null without data: a
// query that never succeeded has dataUpdatedAt 0, and one that is not in the cache has no state at all.
export function asOf(dataUpdatedAt: number | undefined, tz: string, now = Date.now()): string | null {
  if (dataUpdatedAt === undefined || dataUpdatedAt <= 0) return null
  const at = new Date(dataUpdatedAt)
  const time = formatTime(at.toISOString(), tz)
  const day = dateIn(tz, at)
  return day === dateIn(tz, new Date(now)) ? time : `${shortDate(day)}, ${time}`
}
