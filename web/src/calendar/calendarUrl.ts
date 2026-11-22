import { useCallback } from 'react'
import { useSearchParams } from 'react-router'
import { dateIn, useProfileTimezone } from '../board/time'
import { useIsDesktop } from './useIsDesktop'

export type CalendarView = 'day' | 'week'

const MAX_DISTANCE_DAYS = 1800

function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y = 0, m = 1, d = 1] = value.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

export function useCalendarUrl(): {
  view: CalendarView
  date: string | null
  setDate: (date: string) => void
  setView: (view: CalendarView) => void
  goToday: () => void
} {
  const [params, setParams] = useSearchParams()
  const desktop = useIsDesktop()
  const tz = useProfileTimezone()
  const view: CalendarView = !desktop ? 'day' : params.get('view') === 'day' ? 'day' : 'week'
  const raw = params.get('date') ?? params.get('from')
  const today = dateIn(tz)
  const date = raw !== null && isRealDay(raw) && dayDistance(raw, today) <= MAX_DISTANCE_DAYS ? raw : null

  const setDate = useCallback(
    (next: string) => {
      const copy = new URLSearchParams(params)
      copy.delete('from')
      copy.set('date', next)
      setParams(copy)
    },
    [params, setParams],
  )
  const setView = useCallback(
    (next: CalendarView) => {
      const copy = new URLSearchParams(params)
      if (next === 'week') copy.delete('view')
      else copy.set('view', next)
      setParams(copy)
    },
    [params, setParams],
  )
  const goToday = useCallback(() => {
    const copy = new URLSearchParams(params)
    copy.delete('date')
    copy.delete('from')
    setParams(copy)
  }, [params, setParams])

  return { view, date, setDate, setView, goToday }
}
