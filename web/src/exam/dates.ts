// Calendar days as 'YYYY-MM-DD' strings. Arithmetic runs on UTC midnights, so no daylight saving
// change in the browser zone shifts a day; "today" is read in the profile's zone (spec 7.3).

const DAY_MS = 24 * 60 * 60 * 1000

function utc(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1))
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// The calendar day of `at` in `timeZone` ('en-CA' formats as YYYY-MM-DD).
export function todayIn(timeZone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(at)
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(at)
  }
}

// The local wall time of `at` in `timeZone` as 'HH:MM'.
function timeIn(timeZone: string, at: Date): string {
  const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone }).format(at)
  } catch {
    return new Intl.DateTimeFormat('en-GB', options).format(at)
  }
}

// The study day of `at` (the API's study_date, S09): a study day runs from wake_time to sleep_time,
// so until the wake time it is still the day before, for an ordinary day and for a sleep time
// after midnight alike. GET /plan filters its blocks by this day.
export function studyDateIn(timeZone: string, wakeTime: string, at: Date = new Date()): string {
  const day = todayIn(timeZone, at)
  return timeIn(timeZone, at) < wakeTime.slice(0, 5) ? addDays(day, -1) : day
}

export function addDays(day: string, days: number): string {
  return iso(new Date(utc(day).getTime() + days * DAY_MS))
}

// How many days `to` is after `from` (negative when before).
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS)
}

const WEEKDAY = new Intl.DateTimeFormat('he-IL', { weekday: 'short', timeZone: 'UTC' })
const DAY_MONTH = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'UTC' })
const LONG_DATE = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

// "יום ג׳"
export function weekdayShort(day: string): string {
  return WEEKDAY.format(utc(day))
}

// "17.11"
export function dayMonth(day: string): string {
  return DAY_MONTH.format(utc(day))
}

// "20 בינואר 2027"
export function longDate(day: string): string {
  return LONG_DATE.format(utc(day))
}

// A moment as "יום ג׳ 17.11, 09:00" in `timeZone`.
export function momentIn(at: string, timeZone: string): string {
  const date = new Date(at)
  const day = todayIn(timeZone, date)
  let time: string
  try {
    time = new Intl.DateTimeFormat('he-IL', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  } catch {
    time = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  }
  return `${weekdayShort(day)} ${dayMonth(day)}, ${time}`
}
