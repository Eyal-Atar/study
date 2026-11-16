import { useSearchParams } from 'react-router'
import { errorMessage } from '../api/client'
import { usePlan, useToday } from '../board/api'
import { addDays, formatDay, useProfileTimezone, weekStart } from '../board/time'
import type { Block } from '../board/types'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { WeekDay } from './WeekDay'

const DATE = /^\d{4}-\d{2}-\d{2}$/

// A real calendar day 'YYYY-MM-DD' (2026-02-31 is not), else null.
function parseDate(value: string | null): string | null {
  if (value === null || !DATE.test(value)) return null
  return addDays(value, 0) === value ? value : null
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

function ErrorBox({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <p role="alert" className="text-danger">
        {text}
      </p>
      <Button onPress={onRetry}>{he.common.retry}</Button>
    </div>
  )
}

// The seven days from `from` (a Sunday), with the plan of that range.
function WeekBoard({ from, today }: { from: string; today: string | undefined }) {
  const tz = useProfileTimezone()
  const plan = usePlan(from, addDays(from, 6))
  if (plan.isPending) return <Loading />
  if (plan.data === undefined) {
    return (
      <ErrorBox
        text={errorMessage(plan.error)}
        onRetry={() => {
          void plan.refetch()
        }}
      />
    )
  }
  const grouped = byDay(plan.data.blocks)
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i))
  return (
    <>
      {/* A failed refresh keeps the week on screen; the next minute's refetch tries again. */}
      {plan.isError ? <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{he.week.stale}</p> : null}
      <div className="space-y-3">
        {days.map((date) => (
          <WeekDay key={date} date={date} blocks={grouped.get(date) ?? []} tz={tz} isToday={date === today} />
        ))}
      </div>
    </>
  )
}

function Loading() {
  return (
    <p role="status" className="text-ink-muted">
      {he.common.loading}
    </p>
  )
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
      <ErrorBox
        text={errorMessage(today.error)}
        onRetry={() => {
          void today.refetch()
        }}
      />
    )
  } else body = <Loading />

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{he.week.title}</h1>
          {from === undefined ? null : <p className="text-ink-muted">{he.week.range(formatDay(from), formatDay(addDays(from, 6)))}</p>}
        </div>
        {from === undefined ? null : (
          <div role="group" aria-label={he.week.moves} className="grid grid-cols-3 gap-2 sm:flex sm:w-fit">
            <Button
              variant="secondary"
              onPress={() => {
                move(addDays(from, -7))
              }}
            >
              {he.week.previous}
            </Button>
            <Button
              variant="secondary"
              onPress={() => {
                move(null)
              }}
            >
              {he.week.thisWeek}
            </Button>
            <Button
              variant="secondary"
              onPress={() => {
                move(addDays(from, 7))
              }}
            >
              {he.week.next}
            </Button>
          </div>
        )}
      </div>
      {body}
    </div>
  )
}
