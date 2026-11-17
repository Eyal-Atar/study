import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { errorMessage } from '../api/client'
import { usePlan, useToday } from '../board/api'
import { addDays, formatDay, useProfileTimezone, weekStart } from '../board/time'
import type { Block } from '../board/types'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Note } from '../ui/Note'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/states'
import { ICON_STROKE } from '../ui/styles'
import { WeekDay } from './WeekDay'

const DATE = /^\d{4}-\d{2}-\d{2}$/

// A real calendar day 'YYYY-MM-DD' (2026-02-31 is not), else null.
// The API accepts dates within five years of today (plan_views.MAX_DAYS_FROM_TODAY); a date
// further away would only bring a 422 that no retry fixes, so it means the current week.
const MAX_DAYS_AWAY = 1800

function parseDate(value: string | null): string | null {
  if (value === null || !DATE.test(value)) return null
  if (addDays(value, 0) !== value) return null
  const away = Math.abs(Date.parse(`${value}T00:00:00Z`) - Date.now()) / 86_400_000
  return away <= MAX_DAYS_AWAY ? value : null
}

// The server's study_date decides the day of every block (spec 7.3); the times only order a day.
function byDay(blocks: Block[]): Map<string, Block[]> {
  const days = new Map<string, Block[]>()
  for (const block of blocks) {
    const list = days.get(block.study_date) ?? []
    list.push(block)
    days.set(block.study_date, list)
  }
  for (const list of days.values()) list.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  return days
}

// The seven days from `from` (a Sunday), with the plan of that range.
function WeekBoard({ from, today }: { from: string; today: string | undefined }) {
  const tz = useProfileTimezone()
  const plan = usePlan(from, addDays(from, 6))
  if (plan.isPending) return <Loading />
  if (plan.data === undefined) {
    return (
      <ErrorState
        message={errorMessage(plan.error)}
        onRetry={() => {
          void plan.refetch()
        }}
      />
    )
  }
  const grouped = byDay(plan.data.blocks)
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  // Counted over the seven days on screen, not over the answer, so it is true to what is shown.
  const empty = days.every((date) => !grouped.has(date))
  return (
    <>
      {/* A failed refresh keeps the week on screen; the next minute's refetch tries again. */}
      {plan.isError ? <Note tone="warning">{he.week.stale}</Note> : null}
      {empty ? (
        // One sentence instead of seven "free day" lines; the range in the header says which week.
        <EmptyState icon={CalendarDays} title={he.week.empty} />
      ) : (
        <div className="space-y-section">
          {days.map((date) => (
            <WeekDay key={date} date={date} blocks={grouped.get(date) ?? []} tz={tz} isToday={date === today} />
          ))}
        </div>
      )}
    </>
  )
}

// Seven rows, one for each day: the week arrives in the place of the skeleton.
function Loading() {
  return <LoadingState shape="list" rows={7} />
}

// /week: Sunday to Saturday. Without ?from= the week of today's study date (GET /today, in the
// profile's timezone); ?from= on any day shows the week that contains it, and an invalid one the
// current week. The range lives in the URL, so back, forward and a shared link all work.
export function WeekPage() {
  const [params, setParams] = useSearchParams()
  const today = useToday()
  const base = parseDate(params.get('from')) ?? today.data?.date
  const from = base === undefined ? undefined : weekStart(base)

  const move = (date: string | null) => {
    setParams(date === null ? {} : { from: date })
  }

  let body
  if (from !== undefined) body = <WeekBoard from={from} today={today.data?.date} />
  else if (today.isError) {
    body = (
      <ErrorState
        message={errorMessage(today.error)}
        onRetry={() => {
          void today.refetch()
        }}
      />
    )
  } else body = <Loading />

  return (
    <div className="space-y-section">
      {/* Outside every condition: the h1 takes the focus after a navigation. The range and the
          buttons need the week, so they come with it. */}
      <PageHeader
        title={he.week.title}
        subtitle={from === undefined ? undefined : he.week.range(formatDay(from), formatDay(addDays(from, 6)))}
        action={
          from === undefined ? undefined : (
            <div role="group" aria-label={he.week.moves} className="flex items-center gap-2">
              {/* The app is RTL only: back in time is to the right, forward to the left. */}
              <IconButton
                variant="secondary"
                aria-label={he.week.previous}
                onPress={() => {
                  move(addDays(from, -7))
                }}
              >
                <ChevronRight aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
              </IconButton>
              <Button
                variant="secondary"
                onPress={() => {
                  move(null)
                }}
              >
                {he.week.thisWeek}
              </Button>
              <IconButton
                variant="secondary"
                aria-label={he.week.next}
                onPress={() => {
                  move(addDays(from, 7))
                }}
              >
                <ChevronLeft aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
              </IconButton>
            </div>
          )
        }
      />
      {body}
    </div>
  )
}
