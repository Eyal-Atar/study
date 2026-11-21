import { CalendarCheck, CircleCheck } from '../ui/icons'
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { errorMessage } from '../api/client'
import { usePlan, useToday } from '../board/api'
import { REPORT_HASH } from '../board/offerReplan'
import { PlanReport } from '../board/PlanReport'
import { dayLabel, formatDay, formatTime, useProfileTimezone } from '../board/time'
import { en } from '../i18n/en'
import { DayProgress } from '../today/DayProgress'
import { DayTimeline } from '../today/DayTimeline'
import { NextBlock } from '../today/NextBlock'
import { nextLater, nextToday, sortByStart } from '../today/chooseNext'
import { ReviewCard } from '../today/ReviewCard'
import { TodayBlocks } from '../today/TodayBlocks'
import { useTodayView } from '../today/todayView'
import { TodayViewSwitch } from '../today/TodayViewSwitch'
import { Button } from '../ui/Button'
import { ButtonLink } from '../ui/ButtonLink'
import { Note } from '../ui/Note'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/states'

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

// "Today" (S14): what to do now, the rest of today, the minutes done, and what did not fit. S18:
// the morning review, and today's blocks as a list or as a timeline. S27: the next block is the
// first thing under the day's progress, and the review comes after it (decision 3).
export function TodayPage() {
  const today = useToday()
  const [view, setView] = useTodayView()
  const plan = usePlan()
  const tz = useProfileTimezone()
  useScrollToReport((plan.data?.unplaced.length ?? 0) > 0)

  // Outside every condition: the h1 takes the focus after a navigation, before the data arrives.
  const heading = <PageHeader title={en.today.title} subtitle={today.data === undefined ? undefined : formatDay(today.data.date)} />

  if (today.data === undefined) {
    return (
      <div className="space-y-section">
        {heading}
        {today.isError ? (
          <ErrorState
            message={errorMessage(today.error)}
            onRetry={() => {
              void today.refetch()
            }}
          />
        ) : (
          <>
            <LoadingState shape="card" />
            {/* The card above already announces the loading; the rows are only its drawing. */}
            <div aria-hidden="true">
              <LoadingState shape="list" rows={3} />
            </div>
          </>
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
  // block twice would give two buttons the same accessible name.
  // An overdue block is in the review card (S18 decision 13), so the list leaves it out.
  const rest = todays.filter((b) => b.id !== nowBlock?.id && b.state !== 'overdue')
  // The timeline needs the waking hours; without them (or without blocks) only the list is offered.
  const hasTimeline = today.data.day_starts_at !== null && today.data.day_ends_at !== null && todays.length > 0
  const shown = hasTimeline ? view : 'list'
  const toolbar = hasTimeline ? <TodayViewSwitch view={shown} onChange={setView} /> : undefined

  return (
    <div className="space-y-section">
      {heading}

      {today.isError ? (
        <Note
          action={
            <Button
              variant="quiet"
              onPress={() => {
                void today.refetch()
              }}
            >
              {en.common.retry}
            </Button>
          }
        >
          {en.today.stale}
        </Note>
      ) : null}

      <DayProgress done={done_minutes} planned={planned_minutes} />

      {/* What to do now, in one place: the card, or what stands in for it while the week is unknown. */}
      {next !== undefined || planUnknown ? (
        <div className="space-y-2">
          {todays.length === 0 ? <p className="text-small text-ink-muted">{en.today.noBlocksToday}</p> : null}
          {next !== undefined ? (
            <NextBlock
              block={next}
              tz={tz}
              when={laterBlock === undefined ? undefined : en.today.nextAt(dayLabel(laterBlock.study_date, date), formatTime(laterBlock.starts_at, tz))}
            />
          ) : null}
          {planUnknown && plan.isPending ? <LoadingState shape="card" /> : null}
          {planUnknown && plan.isError ? (
            <Note
              action={
                <Button
                  variant="quiet"
                  onPress={() => {
                    void plan.refetch()
                  }}
                >
                  {en.common.retry}
                </Button>
              }
            >
              {en.today.planFailed}
            </Note>
          ) : null}
        </div>
      ) : todays.length === 0 ? (
        // Nothing on the board at all: the way to a plan starts at the exams (S27 decision 11).
        <EmptyState
          icon={CalendarCheck}
          title={en.today.noTasks}
          description={en.today.noTasksHint}
          action={
            <ButtonLink to="/exams" variant="primary">
              {en.today.toExams}
            </ButtonLink>
          }
        />
      ) : (
        <EmptyState icon={CircleCheck} title={en.today.noMoreTasks} description={en.today.noMoreTasksHint} />
      )}

      <ReviewCard />

      {shown === 'timeline' ? (
        <DayTimeline today={today.data} tz={tz} toolbar={toolbar} />
      ) : (
        <TodayBlocks title={nowBlock === undefined ? en.today.blocks : en.today.moreBlocks} blocks={rest} tz={tz} toolbar={toolbar} />
      )}

      <PlanReport />
    </div>
  )
}
