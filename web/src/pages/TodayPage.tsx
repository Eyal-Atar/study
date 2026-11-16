import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { errorMessage } from '../api/client'
import { usePlan, useToday } from '../board/api'
import { REPORT_HASH } from '../board/offerReplan'
import { PlanReport } from '../board/PlanReport'
import { dayLabel, formatDay, formatTime, useProfileTimezone } from '../board/time'
import { he } from '../i18n/he'
import { DayProgress } from '../today/DayProgress'
import { NextBlock } from '../today/NextBlock'
import { nextLater, nextToday, sortByStart } from '../today/chooseNext'
import { TodayBlocks } from '../today/TodayBlocks'
import { Button } from '../ui/Button'

// offerReplan sends the user to /today#report; the report renders only after GET /plan answers, so
// the browser's own jump to the anchor finds nothing. Scroll once the report is there, once per visit.
function useScrollToReport(ready: boolean) {
  const location = useLocation()
  const done = useRef<string | null>(null)
  useEffect(() => {
    if (!ready || location.hash !== REPORT_HASH || done.current === location.key) return
    const report = document.getElementById('report')
    if (report === null) return
    done.current = location.key
    report.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [ready, location.hash, location.key])
}

// "Today" (S14): what to do now, the rest of today, the minutes done, and what did not fit.
export function TodayPage() {
  const today = useToday()
  const plan = usePlan()
  const tz = useProfileTimezone()
  useScrollToReport((plan.data?.unplaced.length ?? 0) > 0)

  const heading = (
    <div className="space-y-1">
      <h1 className="text-2xl font-bold">{he.today.title}</h1>
      {today.data === undefined ? null : <p className="text-ink-muted">{formatDay(today.data.date)}</p>}
    </div>
  )

  if (today.data === undefined) {
    return (
      <div className="space-y-6">
        {heading}
        {today.isError ? (
          <div className="space-y-3 rounded-xl border border-danger bg-danger-soft p-4">
            <p role="alert" className="text-danger">
              {errorMessage(today.error)}
            </p>
            <Button
              variant="secondary"
              onPress={() => {
                void today.refetch()
              }}
            >
              {he.common.retry}
            </Button>
          </div>
        ) : (
          <p role="status" className="text-ink-muted">
            {he.common.loading}
          </p>
        )}
      </div>
    )
  }

  const { date, blocks, planned_minutes, done_minutes } = today.data
  const todays = sortByStart(blocks)
  const nowBlock = nextToday(todays)
  // Only when today has no next block does the week answer; until it does, nothing is guessed.
  const laterBlock = nowBlock === undefined && plan.data !== undefined ? nextLater(plan.data.blocks, date) : undefined
  const next = nowBlock ?? laterBlock
  const planUnknown = nowBlock === undefined && plan.data === undefined
  // The next block is today's, so it has its own card above and is left out of the list: the same
  // card twice would repeat its element ids and give two buttons the same accessible name.
  const rest = nowBlock === undefined ? todays : todays.filter((b) => b.id !== nowBlock.id)

  return (
    <div className="space-y-6">
      {heading}

      {today.isError ? (
        <div className="flex flex-wrap items-center gap-x-3 text-sm text-ink-muted">
          <p>{he.today.stale}</p>
          <Button
            variant="quiet"
            onPress={() => {
              void today.refetch()
            }}
          >
            {he.common.retry}
          </Button>
        </div>
      ) : null}

      <DayProgress done={done_minutes} planned={planned_minutes} />

      {todays.length === 0 && (next !== undefined || planUnknown) ? <p className="text-ink-muted">{he.today.noBlocksToday}</p> : null}

      {next !== undefined ? (
        <NextBlock
          block={next}
          tz={tz}
          when={laterBlock === undefined ? undefined : he.today.nextAt(dayLabel(laterBlock.study_date, date), formatTime(laterBlock.starts_at, tz))}
        />
      ) : null}

      {planUnknown && plan.isPending ? (
        <p role="status" className="text-sm text-ink-muted">
          {he.common.loading}
        </p>
      ) : null}
      {planUnknown && plan.isError ? (
        <div className="flex flex-wrap items-center gap-x-3 text-sm text-ink-muted">
          <p>{he.today.planFailed}</p>
          <Button
            variant="quiet"
            onPress={() => {
              void plan.refetch()
            }}
          >
            {he.common.retry}
          </Button>
        </div>
      ) : null}

      {next === undefined && !planUnknown ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-ink-muted">
          {todays.length === 0 ? he.today.noTasks : he.today.noMoreTasks}
        </p>
      ) : null}

      <TodayBlocks title={nowBlock === undefined ? he.today.blocks : he.today.moreBlocks} blocks={rest} tz={tz} />

      <PlanReport />
    </div>
  )
}
