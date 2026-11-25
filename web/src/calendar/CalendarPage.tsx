import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { errorMessage } from '../api/client'
import { useShellFrame } from '../app/shellFrame'
import { ShellToolbar } from '../app/ShellToolbar'
import { Archie } from '../archie/Archie'
import { useBlockActions } from '../board/actions'
import { useBoardUserId } from '../board/api'
import { REPORT_HASH } from '../board/offerReplan'
import { useReview } from '../board/review'
import { addDays, dateIn, useProfileTimezone } from '../board/time'
import type { Block } from '../board/types'
import { useClosures } from '../closure/api'
import { seenKey, wasShown } from '../closure/seen'
import { en } from '../i18n/en'
import { sortByStart } from '../today/chooseNext'
import { Button } from '../ui/Button'
import { ButtonLink } from '../ui/ButtonLink'
import { Note } from '../ui/Note'
import { ErrorState, LoadingState } from '../ui/states'
import { archiMoment } from './archi'
import { useHiddenBusy } from './busyActions'
import { instantOf } from './busyTime'
import { BreakNotice } from './BreakNotice'
import { CalendarBanner } from './CalendarBanner'
import { CalendarSheets, type SheetState } from './CalendarSheets'
import { CalendarToolbar } from './CalendarToolbar'
import { useCalendarUrl } from './calendarUrl'
import { DayStrip } from './DayStrip'
import { restDays, shortDate, streakDays, wakingSpan, weekDays, weekRangeText } from './days'
import { gridSpan, HOUR_PX, localMinutes } from './geometry'
import type { Ghost } from './ghost'
import { PhoneHeader } from './PhoneHeader'
import { Sidebar } from './Sidebar'
import { TasksSheet } from './TasksSheet'
import { TimeGrid } from './TimeGrid'
import { STICKY_ATTRIBUTE, useAutoScroll } from './useAutoScroll'
import { useCalendarData } from './useCalendarData'
import { useIsDesktop } from './useIsDesktop'
import { useNow } from './useNow'
import { XpBurst } from './XpBurst'

const HOUR_MS = 3_600_000
const NO_DAYS = new Set<string>()

// The blocks of the range, with today's column taken from GET /today (the fresher of the two: the
// side panel and the minutes read it), each block once.
function mergeBlocks(planBlocks: Block[], todayBlocks: Block[], today: string | undefined): Block[] {
  const ids = new Set(todayBlocks.map((b) => b.id))
  return [...planBlocks.filter((b) => b.study_date !== today && !ids.has(b.id)), ...todayBlocks]
}

// The next round hour, for an hour, on `date`: the busy time that "Mark busy time" starts from.
function nextHourDraft(date: string, today: string, now: number, tz: string): { date: string; startsAt: string; endsAt: string } {
  let hour = Math.floor(localMinutes(new Date(now).toISOString(), today, tz) / 60) + 1
  let day = date
  if (day === today && hour >= 24) day = addDays(day, Math.floor(hour / 24))
  hour %= 24
  const start = instantOf(day, `${String(hour).padStart(2, '0')}:00`, tz) ?? now
  return { date: day, startsAt: new Date(start).toISOString(), endsAt: new Date(start + HOUR_MS).toISOString() }
}

// The calendar (S32): the home of the app. Every part was built on its own (Tasks 0–12); this is
// where they meet.
//
// - Data: the week of the date in the URL (or of today) from GET /plan, the seven days from today
//   from GET /plan with no range (Up next, the free-time list, the empty state), today from
//   GET /today, and the profile's waking hours for the other days (useCalendarData).
// - On a computer: the side panel, and beside it the banner and the grid of the week or the day, in
//   a box that scrolls under the shell's top bar; the toolbar lives in the shell's header
//   (ShellToolbar). The only h1 is out of sight: the title and the range.
// - On a phone: the header (the h1) and the strip of days stay at the top, the grid of one day
//   scrolls with the window, and the tasks bar sits above the navigation.
// - One sheet at a time (CalendarSheets), and two lists of ghosts, of which the grid draws one:
//   `ghosts` is the open sheet's, and a move to another date or view closes the sheet and clears it;
//   `bannerGhosts` is the banner's (the split offer of S44, while its row is open). The parts of a
//   split spread over days, sometimes into the next week, so that list stays across a move, and
//   only the row clears it. An open sheet has the grid to itself; when it closes, the banner's
//   ghosts show again.
// - The closure of an exam (S45): GET /closures' `pending` is the server's word on which exams wait
//   for the student's decision (it opens them at 19:00 on the evening of the exam). The closure sheet
//   is a branch of SheetState: the banner's row opens it, and it opens by itself once per exam and
//   sitting on this device (closure/seen.ts), when no other sheet is open. It is not about the week on
//   screen, so a move to another date or view leaves it open.
export function CalendarPage() {
  useShellFrame({ fullBleed: true, ownPhoneHeader: true })
  const desktop = useIsDesktop()
  const { view, date, setDate, setView, goToday } = useCalendarUrl()
  const tz = useProfileTimezone()
  const now = useNow()
  const data = useCalendarData(date)
  const review = useReview()
  const actions = useBlockActions()
  // The events deleted on screen whose Undo window is still open (busyActions.ts).
  const hidden = useHiddenBusy()
  const location = useLocation()
  const [sheet, setSheet] = useState<SheetState>(null)
  // The phone's tasks sheet (TasksSheet): a sheet too, though not one of CalendarSheets'.
  const [tasksOpen, setTasksOpen] = useState(false)
  const userId = useBoardUserId()
  const closures = useClosures()
  const pendingClosures = closures.data?.pending
  // The closures that were pending when the sheet last opened by itself. Each is offered by itself
  // once in this visit: the X on the first of two exams of the same evening leaves the second to the
  // banner's row (which counts them), instead of opening it at once.
  const offered = useRef(new Set<string>())
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [bannerGhosts, setBannerGhosts] = useState<Ghost[]>([])
  // The heading above the banner: where the focus goes when the split row leaves from under it.
  const planHeading = useRef<HTMLHeadingElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const gridBox = useRef<HTMLDivElement>(null)

  // A move to another date or view leaves no sheet open and no ghost behind (Review Focus 6).
  // During the render, so no frame shows a sheet of the range that was left.
  const navigation = `${view}|${date ?? ''}`
  const [shownNavigation, setShownNavigation] = useState(navigation)
  if (shownNavigation !== navigation) {
    setShownNavigation(navigation)
    // The closure sheet is about an exam, not the range that was left.
    if (sheet?.kind !== 'closure') setSheet(null)
    setGhosts([])
  }

  const todayData = data.today.data
  const planData = data.plan.data
  const today = todayData?.date

  // The closure sheet opens by itself (plan decisions 1–2): the first pending exam whose sheet this
  // device has not shown yet, once the calendar has its day and no other sheet is open, the phone's
  // tasks sheet included (it waits for that one to close). It counts as shown when it shows
  // (CalendarSheets, onShown), not here.
  useEffect(() => {
    if (today === undefined || sheet !== null || tasksOpen || userId === null || pendingClosures === undefined) return
    const item = pendingClosures.find((i) => !wasShown(userId, i) && !offered.current.has(seenKey(i)))
    if (item === undefined) return
    for (const i of pendingClosures) offered.current.add(seenKey(i))
    setSheet({ kind: 'closure', examId: item.exam_id })
  }, [today, sheet, tasksOpen, userId, pendingClosures])
  const selected = date ?? today
  const week = selected === undefined ? [] : weekDays(selected)
  const days = selected === undefined ? [] : view === 'week' ? week : [selected]
  const todayBlocks = todayData?.blocks ?? []
  const blocks = mergeBlocks(planData?.blocks ?? [], todayBlocks, today)
  const busy = data.busy.filter((item) => !hidden.has(item.id))
  const me = data.me.data
  const rangeText = selected === undefined ? '' : view === 'week' ? weekRangeText(days) : shortDate(selected)
  const reviewCount = (review.data?.blocks ?? []).filter((block) => block.status === 'planned').length
  const unplacedCount = planData?.unplaced.length ?? 0

  const dayBounds = useCallback(
    (day: string) => {
      if (todayData !== undefined && day === todayData.date) {
        const { day_starts_at: start, day_ends_at: end } = todayData
        return { dayStart: start === null ? null : Date.parse(start), dayEnd: end === null ? null : Date.parse(end) }
      }
      return wakingSpan(day, me, tz)
    },
    [todayData, me, tz],
  )

  const ready = todayData !== undefined && planData !== undefined && selected !== undefined && today !== undefined
  // A block still to come in the seven days from today (whatever week is on screen). While that
  // answer loads the calendar is not called empty; if it fails, the range alone decides.
  const aheadBlocks = data.ahead.data?.blocks ?? []
  const blockAhead = data.ahead.isPending || aheadBlocks.some((block) => block.state === 'upcoming')
  // Nothing at all to show: no block in the range or ahead, nothing that did not fit and nothing to
  // review. A past week with nothing in it is only a past week.
  const empty =
    ready &&
    blocks.length === 0 &&
    !blockAhead &&
    unplacedCount === 0 &&
    reviewCount === 0 &&
    (days[days.length - 1] ?? '') >= today
  const showGrid = ready && !empty
  // The tasks sheet leaves the tree with its bar (a computer's width, a day that empties) without
  // calling onOpenChange: an open flag left behind would hold the closure sheet back for the whole
  // visit. Reset during the render, as the navigation above.
  const tasksShown = !desktop && todayData !== undefined && !empty
  if (!tasksShown && tasksOpen) setTasksOpen(false)
  // Not on the previous week kept on screen while the next one loads (placeholder data): that grid
  // has no block of the new week, and would take the one scroll the new week gets (decision 13).
  useAutoScroll(scroller, gridBox, `${view}|${days[0] ?? ''}`, showGrid && !data.plan.isPlaceholderData)

  const rest = ready ? restDays(week, blocks, today) : NO_DAYS
  const streak = streakDays(data.progress.data)
  const hour = today === undefined ? 0 : Math.floor(localMinutes(new Date(now).toISOString(), today, tz) / 60) % 24
  const moment = archiMoment({
    reviewCount,
    unplacedCount,
    todayIsRest: today !== undefined && rest.has(today),
    todayBlocks,
    hour,
  })
  // What the free-time sheet can bring forward: the next blocks from now, not the week on screen.
  const upcoming = sortByStart(
    mergeBlocks(aheadBlocks, todayBlocks, today).filter((b) => b.status === 'planned' && Date.parse(b.starts_at) > now),
  )

  const openBlock = (block: Block) => {
    setSheet({ kind: 'block', block })
  }
  const deferBlock = (block: Block) => {
    setSheet({ kind: 'defer', block })
  }
  const freeTime = () => {
    setSheet({ kind: 'freeTime' })
  }
  const markBusy = () => {
    if (today === undefined || selected === undefined) return
    setSheet({ kind: 'busyNew', draft: nextHourDraft(selected < today ? today : selected, today, now, tz) })
  }
  const move = (step: number) => {
    if (selected !== undefined) setDate(addDays(selected, step))
  }

  const stale = (data.today.isError && todayData !== undefined) || (data.plan.isError && planData !== undefined)
  const retry = () => {
    void data.today.refetch()
    void data.plan.refetch()
  }

  // What stands in the place of the grid: the loading, an error, the empty calendar, or the grid.
  function body(hourPx: number, onSwipeDay?: (direction: 1 | -1) => void) {
    if (todayData === undefined || planData === undefined) {
      const failed = todayData === undefined ? data.today : data.plan
      if (failed.isError) {
        return (
          <ErrorState
            message={errorMessage(failed.error)}
            onRetry={() => {
              void failed.refetch()
            }}
          />
        )
      }
      return <LoadingState shape="card" />
    }
    if (!showGrid) return <EmptyCalendar />
    return (
      <div ref={gridBox}>
        <TimeGrid
          days={days}
          today={today}
          view={view}
          span={gridSpan({ days, blocks, busy, wake: me?.wake_time ?? null, sleep: me?.sleep_time ?? null, tz })}
          hourPx={hourPx}
          blocks={blocks}
          busy={busy}
          ghosts={sheet === null ? bannerGhosts : ghosts}
          tz={tz}
          now={now}
          restDays={rest}
          streakDays={streak}
          showHeader={desktop}
          rangeText={rangeText}
          onOpenBlock={openBlock}
          onOpenBusy={(item) => {
            setSheet(item.source === 'event' ? { kind: 'busyEdit', item } : { kind: 'commitment', item })
          }}
          dayBounds={dayBounds}
          onSwipeAction={(block, action) => {
            if (action === 'defer') deferBlock(block)
            else actions.skip(block)
          }}
          onCreateBusy={(range) => {
            setSheet({ kind: 'busyNew', draft: range })
          }}
          {...(onSwipeDay === undefined ? {} : { onSwipeDay })}
        />
      </div>
    )
  }

  const staleNote = stale ? (
    <div className="px-4 py-2">
      <Note
        tone="warning"
        action={
          <Button variant="secondary" onPress={retry}>
            {en.common.retry}
          </Button>
        }
      >
        {en.calendar.page.stale}
      </Note>
    </div>
  ) : null

  const banner = ready ? (
    <CalendarBanner
      unplacedCount={unplacedCount}
      {...(location.hash === REPORT_HASH ? { expandTo: 'report' as const } : {})}
      onPreview={setBannerGhosts}
      onOpenClosure={(examId) => {
        setSheet({ kind: 'closure', examId })
      }}
      blocks={blocks}
      exams={data.exams.data ?? []}
      me={me}
      tz={tz}
      now={now}
      today={today}
      focusAfter={planHeading}
    />
  ) : null

  const sheets =
    today === undefined ? null : (
      <CalendarSheets
        sheet={sheet}
        setSheet={setSheet}
        setGhosts={setGhosts}
        blocks={blocks}
        upcoming={upcoming}
        tz={tz}
        today={today}
        now={now}
        pending={pendingClosures ?? []}
        focusAfter={planHeading}
      />
    )

  const breakNotice = todayData === undefined ? null : <BreakNotice todayBlocks={todayBlocks} now={now} tz={tz} />

  if (desktop) {
    return (
      <>
        <h1 className="sr-only">{en.calendar.page.heading(selected === undefined ? null : rangeText)}</h1>
        {selected === undefined ? null : (
          <ShellToolbar>
            <CalendarToolbar
              view={view}
              rangeText={rangeText}
              onToday={goToday}
              onPrevious={() => {
                move(view === 'week' ? -7 : -1)
              }}
              onNext={() => {
                move(view === 'week' ? 7 : 1)
              }}
              onView={setView}
            />
          </ShellToolbar>
        )}
        <div className="grid h-[calc(100dvh-var(--spacing-topbar))] grid-cols-[300px_1fr]">
          <div className="flex min-h-0">
            {todayData === undefined ? null : (
              <Sidebar
                todayData={todayData}
                ahead={data.ahead.data}
                exams={data.exams.data ?? []}
                tz={tz}
                moment={moment}
                onFreeTime={freeTime}
                onMarkBusy={markBusy}
                onDefer={deferBlock}
                onOpenBlock={openBlock}
              />
            )}
          </div>
          <div className="relative flex min-h-0 min-w-0 flex-col">
            {/* The banner's rows are h3 (the review's blocks): their parent, out of sight. */}
            <h2 ref={planHeading} tabIndex={-1} className="sr-only">
              {en.calendar.page.planHeading}
            </h2>
            {banner}
            {staleNote}
            <div ref={scroller} data-calendar-scroller="" className="min-h-0 flex-1 overflow-y-auto">
              {body(HOUR_PX.desktop)}
            </div>
            {breakNotice}
          </div>
        </div>
        {sheets}
        <XpBurst />
      </>
    )
  }

  const phoneDate = selected ?? dateIn(tz)
  return (
    // Room under the last hour for the tasks bar, which floats above the navigation.
    <div className="pb-16">
      <div {...{ [STICKY_ATTRIBUTE]: '' }} className="sticky top-0 z-30 bg-canvas">
        <PhoneHeader
          date={phoneDate}
          today={today ?? phoneDate}
          onWeek={(step) => {
            move(step * 7)
          }}
        />
        {selected === undefined || today === undefined ? null : (
          <DayStrip
            days={week}
            selected={selected}
            today={today}
            blocks={empty ? [] : blocks}
            streakDays={empty ? NO_DAYS : streak}
            onSelect={setDate}
          />
        )}
      </div>
      <h2 ref={planHeading} tabIndex={-1} className="sr-only">
        {en.calendar.page.planHeading}
      </h2>
      {banner}
      {staleNote}
      {body(HOUR_PX.phone, move)}
      {/* The empty calendar has no tasks bar (as in the prototype): there is no block to list. */}
      {todayData === undefined || empty ? null : (
        <TasksSheet
          todayData={todayData}
          tz={tz}
          onFreeTime={freeTime}
          onMarkBusy={markBusy}
          onOpenBlock={openBlock}
          open={tasksOpen}
          onOpenChange={setTasksOpen}
        />
      )}
      {breakNotice}
      {sheets}
      <XpBurst />
    </div>
  )
}

// Nothing on the calendar at all: Archi at rest, and the way to a plan, which starts at the exams.
function EmptyCalendar() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-page py-section text-center">
      <div className="w-[270px]">
        <Archie mood="rest" decorative />
      </div>
      <h2 className="text-title font-semibold">{en.today.noTasks}</h2>
      <p className="text-ink-muted">{en.today.noTasksHint}</p>
      <ButtonLink to="/exams" variant="primary">
        {en.today.toExams}
      </ButtonLink>
    </div>
  )
}
