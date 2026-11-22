const MINUTE_MS = 60_000

const offsetFormats = new Map<string, Intl.DateTimeFormat>()

function offsetMinutes(ms: number, tz: string): number {
  let format = offsetFormats.get(tz)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
    offsetFormats.set(tz, format)
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(format.formatToParts(ms).find((p) => p.type === type)?.value ?? 0)
  const local = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'))
  return Math.round((local - Math.floor(ms / MINUTE_MS) * MINUTE_MS) / MINUTE_MS)
}

// The instant of a wall-clock date and "HH:MM" in `tz` (two passes, so a clock change is right).
export function instantOf(date: string, time: string, tz: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null
  const guess = Date.parse(`${date}T${time}:00Z`)
  if (Number.isNaN(guess)) return null
  const first = guess - offsetMinutes(guess, tz) * MINUTE_MS
  return guess - offsetMinutes(first, tz) * MINUTE_MS
}
