import { useMe } from '../api/me'
import { en } from '../i18n/en'
import { LOCALE } from '../i18n/locale'
import type { Block } from './types'

// Times on the board are shown in the profile's timezone, not the browser's (spec 7.3): the server
// decides each block's study_date there. Dates are 'YYYY-MM-DD' strings, computed on the calendar
// (UTC arithmetic on the date alone), so no timezone or clock change moves them.

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

// The `timezone` field of a GET /me answer, checked at runtime, else `fallback`.
export function pickTimezone(me: unknown, fallback: string): string {
  if (typeof me !== 'object' || me === null) return fallback
  const value = (me as Record<string, unknown>).timezone
  return typeof value === 'string' && isTimezone(value) ? value : fallback
}

// The profile's timezone from GET /me (checked, since a bad name would throw in Intl), else the
// browser's until /me answers.
export function useProfileTimezone(): string {
  const me = useMe()
  return pickTimezone(me.data, browserTimezone())
}

const timeFormats = new Map<string, Intl.DateTimeFormat>()

function timeFormat(tz: string): Intl.DateTimeFormat {
  let format = timeFormats.get(tz)
  if (format === undefined) {
    // en-GB with h23, not LOCALE: a machine-stable 'HH:MM' (never '24:30') that tests and ranges rely on.
    format = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    timeFormats.set(tz, format)
  }
  return format
}

// 'HH:MM', 24-hour, in `tz`.
export function formatTime(iso: string, tz: string): string {
  return timeFormat(tz).format(new Date(iso))
}

// 'HH:MM–HH:MM'
export function formatRange(block: Pick<Block, 'starts_at' | 'ends_at'>, tz: string): string {
  return `${formatTime(block.starts_at, tz)}–${formatTime(block.ends_at, tz)}`
}

// Between the two instants, not the wall clock: across the switch to winter time 00:30–01:30 is 120 minutes.
export function blockMinutes(block: Pick<Block, 'starts_at' | 'ends_at'>): number {
  return Math.round((Date.parse(block.ends_at) - Date.parse(block.starts_at)) / 60000)
}

// The calendar day of `at` in `tz`, 'YYYY-MM-DD'.
export function dateIn(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

function parts(date: string): [number, number, number] {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  return [y, m, d]
}

function utcDay(date: string): Date {
  const [y, m, d] = parts(date)
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDays(date: string, n: number): string {
  const day = utcDay(date)
  day.setUTCDate(day.getUTCDate() + n)
  return day.toISOString().slice(0, 10)
}

// The Sunday that starts the week of `date`: the product's week starts on Sunday (LOCALE en-IL).
export function weekStart(date: string): string {
  return addDays(date, -utcDay(date).getUTCDay())
}

// The date is a calendar day, so it is formatted in UTC on its own UTC midnight: no timezone moves it.
const DAY_FORMAT = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

// "Sun, 22 Nov" (the one short date form of the product)
export function formatDay(date: string): string {
  return DAY_FORMAT.format(utcDay(date))
}

// Today, tomorrow or yesterday relative to `today`, else formatDay.
export function dayLabel(date: string, today: string): string {
  if (date === today) return en.board.today
  if (date === addDays(today, 1)) return en.board.tomorrow
  if (date === addDays(today, -1)) return en.board.yesterday
  return formatDay(date)
}

function hoursText(hours: number): string {
  if (hours === 1) return en.board.hour
  if (hours === 2) return en.board.twoHours
  return en.board.hours(hours)
}

// Under an hour in minutes; whole and half hours as hours (an hour and a half, 2.5 hours); else hours and minutes.
export function durationText(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total === 1) return en.board.minute
  if (total < 60) return en.board.minutes(total)
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (rest === 0) return hoursText(hours)
  if (rest === 30) return hours === 1 ? en.board.hourAndHalf : en.board.hours(hours + 0.5)
  return en.board.hoursAndMinutes(hoursText(hours), rest)
}
