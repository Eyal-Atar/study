import type { UseQueryResult } from '@tanstack/react-query'
import type { ApiError } from '../api/client'
import { useMe } from '../api/me'
import type { Me } from '../api/me'
import type { BusyItem } from '../availability/types'
import { usePlan, useToday } from '../board/api'
import type { Plan, Today } from '../board/types'
import { useExams } from '../onboarding/api'
import type { Exam } from '../onboarding/types'
import { useProgress } from '../progress/api'
import type { Progress } from '../progress/types'
import { weekDays } from './days'

const NO_BUSY: BusyItem[] = []

// Everything the calendar reads. The week is the one of `date`, or of today when there is no date.
// Two plan queries: `plan` is the week on screen (asked for once the week is known), and `ahead`
// is the server's seven days from today (no range), which is what belongs to "now": Up next, the
// free-time sheet's list, and whether the calendar is empty.
export function useCalendarData(date: string | null): {
  today: UseQueryResult<Today, ApiError>
  plan: UseQueryResult<Plan, ApiError>
  ahead: UseQueryResult<Plan, ApiError>
  me: UseQueryResult<Me, ApiError>
  progress: UseQueryResult<Progress, ApiError>
  exams: UseQueryResult<Exam[], ApiError>
  busy: BusyItem[]
  days: string[]
  anchor: string | undefined
} {
  const today = useToday()
  const me = useMe()
  const progress = useProgress()
  const exams = useExams()
  const anchor = date ?? today.data?.date
  const days = anchor === undefined ? [] : weekDays(anchor)
  const plan = usePlan(days[0], days[6], { enabled: days.length > 0, keepPrevious: true })
  const ahead = usePlan()
  const busy = plan.data?.busy ?? today.data?.busy ?? NO_BUSY
  return { today, plan, ahead, me, progress, exams, busy, days, anchor }
}
