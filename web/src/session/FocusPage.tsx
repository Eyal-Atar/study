import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { errorMessage } from '../api/client'
import type { ArchieMood } from '../archie/Archie'
import { Archie } from '../archie/Archie'
import { useShellFrame } from '../app/shellFrame'
import { useBlockActions } from '../board/actions'
import { useBoardUserId, useToday } from '../board/api'
import { blockName } from '../board/blockName'
import { formatTime, useProfileTimezone } from '../board/time'
import type { Block } from '../board/types'
import { noteArchiInterrupt } from '../calendar/archi'
import { en } from '../i18n/en'
import { nextToday } from '../today/chooseNext'
import { Button } from '../ui/Button'
import { examColor } from '../ui/examColor'
import { IconButton } from '../ui/IconButton'
import { ProgressRing } from '../ui/ProgressRing'
import { ChevronLeft, KIND_ICON } from '../ui/icons'
import { ErrorState } from '../ui/states'
import { cx, ICON_STROKE } from '../ui/styles'
import { UserText } from '../ui/UserText'
import { useToast } from '../ui/useToast'
import {
  breakAfterFocus,
  clearSession,
  minutesLeft,
  newSession,
  useFocusSession,
  writeSession,
  type FocusClock,
  type FocusSession,
} from './focusSession'
import { useFocusClock } from './useFocusClock'
import { focusView, type FocusView } from './focusView'
import { useWakeLock } from './useWakeLock'

// Not imported from routes.tsx, which imports this file.
const CALENDAR_PATH = '/calendar'

// Archi on the focus screen (S42 decision 7). 'wisdom' stands in while he studies, the ink at the tip
// of his brush being the nearest to focused writing: when an 'archi-writing' asset exists (the audit's
// asset checklist), `running` is the one line to change.
const FOCUS_MOOD = { running: 'wisdom', over: 'joy', rest: 'rest', gone: 'flow' } as const satisfies Record<
  string,
  ArchieMood
>

// The views where a session of this block has nothing left to time.
const CLEARS: readonly FocusView[] = ['gone', 'alreadyDone', 'notToday', 'ended']

// 1-based day of the year of a YYYY-MM-DD date, in UTC: the same pick as archiLine (calendar/archi.ts).
function dayOfYear(date: string): number {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number)
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1
}

function moodOf(view: FocusView): ArchieMood {
  switch (view) {
    case 'over':
    case 'ended':
    case 'alreadyDone':
      return FOCUS_MOOD.over
    case 'break':
      return FOCUS_MOOD.rest
    case 'gone':
    case 'notToday':
    case 'error':
      return FOCUS_MOOD.gone
    default:
      return FOCUS_MOOD.running
  }
}

// The focus screen (S42): a calm screen of its own, with Archi studying beside the student, a timer
// that changes only once a minute, the task's name, and Done. The session lives on the device
// (focusSession.ts); the timer is the wall clock (useFocusClock). See the plan's decisions 6–15.
export function FocusPage() {
  useShellFrame({ bare: true })
  const { blockId = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const userId = useBoardUserId()
  const tz = useProfileTimezone()
  const actions = useBlockActions()
  const today = useToday()
  const session = useFocusSession()
  const own = session !== null && session.blockId === blockId ? session : null
  const { now, clock } = useFocusClock(own)
  const [finished, setFinished] = useState<'break' | 'leaving' | null>(null)
  // The block a session was started or ended for here: a session is written from the address once,
  // also under StrictMode, and never again after Stop cleared it on the way out.
  const handled = useRef<string | null>(null)

  const view = focusView({
    finished,
    today: { isPending: today.isPending, isError: today.isError, data: today.data },
    blockId,
    session,
    now,
  })
  const block: Block | undefined = today.data?.blocks.find((b) => b.id === blockId)

  // Opened from the address with no session of this block (a direct link, a storage that throws): a
  // block that can start gets a full one. Before the paint, so the ring is never drawn empty.
  useLayoutEffect(() => {
    if (view !== 'full' || own !== null || block === undefined || userId === null) return
    if (handled.current === blockId) return
    handled.current = blockId
    writeSession(userId, newSession(block, 'full', Date.now()))
  }, [view, own, block, userId, blockId])

  // A block that changed elsewhere (done, deferred, skipped in another tab) leaves no orphan timer.
  useEffect(() => {
    if (!CLEARS.includes(view) || userId === null) return
    if (session !== null && session.blockId === blockId) clearSession(userId)
  }, [view, session, blockId, userId])

  useWakeLock(view === 'five' || view === 'full')

  function leave() {
    void navigate(CALENDAR_PATH, { replace: true })
  }

  function endAndLeave() {
    handled.current = blockId
    if (userId !== null) clearSession(userId)
    leave()
  }

  function stop() {
    endAndLeave()
    toast.show({ text: en.focus.stopped, tone: 'info' })
  }

  function done() {
    if (finished !== null || block === undefined || today.data === undefined) return
    const at = Date.now()
    // Before the call, while the block is still planned in the cache.
    const brk = breakAfterFocus(today.data.blocks, block, own ?? newSession(block, 'full', at), at)
    actions.complete(block)
    handled.current = blockId
    if (userId !== null) clearSession(userId)
    setFinished(brk ? 'break' : 'leaving')
    if (brk) noteArchiInterrupt(at)
    else leave()
  }

  const timed = view === 'five' || view === 'full' || view === 'over'
  const endsAtIso = own === null ? null : new Date(own.endsAt).toISOString()
  const untilTime = endsAtIso === null ? '' : formatTime(endsAtIso, tz)

  let line = ''
  if (block !== undefined) {
    if (view === 'five') line = en.focus.fiveTask[block.task_kind]
    else if (view === 'full' && own !== null && own.fiveEndsAt !== null) line = en.focus.fiveDone(untilTime)
    else if (view === 'full') line = en.focus.running[dayOfYear(today.data?.date ?? '') % 3] ?? ''
  }
  if (view === 'over') line = en.focus.over
  else if (view === 'ended') line = en.focus.ended
  else if (view === 'alreadyDone') line = en.focus.alreadyDone
  else if (view === 'gone') line = en.focus.gone
  else if (view === 'notToday') line = en.focus.notToday
  else if (view === 'break') line = en.calendar.archi.breakTitle

  const KindIcon = block === undefined ? null : KIND_ICON[block.task_kind]
  const next = view === 'break' && today.data !== undefined ? nextToday(today.data.blocks) : undefined
  const NextIcon = next === undefined ? null : KIND_ICON[next.task_kind]

  const doneButton = (variant: 'primary' | 'secondary') =>
    block === undefined ? null : (
      <Button
        variant={variant}
        aria-label={en.board.completeLabel(blockName(block))}
        isDisabled={actions.pending(block.id)}
        onPress={done}
      >
        {en.board.complete}
      </Button>
    )

  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-page pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div className="flex justify-start">
        <IconButton aria-label={en.focus.back} onPress={leave}>
          <ChevronLeft aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 text-center">
        {/* He stands on the line of the surface, with no backdrop and no frame (the audit, 3). */}
        <div className="flex w-full justify-center border-b border-line">
          <div className="w-[220px] lg:w-[260px]">
            <Archie mood={moodOf(view)} size="scene" decorative />
          </div>
        </div>
        {/* The one live region: its text changes only when the phase does, never each minute. */}
        <p role="status" className="text-[17px] leading-[1.3] font-semibold text-ink">
          {line}
        </p>

        {timed && own !== null && clock !== null ? (
          <div className="flex flex-col items-center gap-2">
            <ProgressTimer view={view} session={own} clock={clock} until={untilTime} />
            <p className="text-small text-ink-muted tabular-nums">{en.focus.until(untilTime)}</p>
          </div>
        ) : null}

        {view === 'break' ? (
          <div className="w-full">
            <p className="text-small text-ink-muted">
              {en.calendar.archi.breakBody(next === undefined ? null : formatTime(next.starts_at, tz))}
            </p>
            {next === undefined || NextIcon === null ? null : (
              <p className="mt-1.5 flex items-center justify-center gap-1.5">
                <NextIcon
                  aria-hidden="true"
                  size={16}
                  strokeWidth={ICON_STROKE}
                  className={cx('shrink-0', examColor(next.exam_color_index).text)}
                />
                <UserText truncate className="min-w-0 font-semibold">
                  {next.task_title}
                </UserText>
              </p>
            )}
          </div>
        ) : null}

        <div className="flex w-full flex-col items-center gap-1">
          {/* The same h1 in every view, so the focus after a navigation lands on it (decision 14). */}
          <h1 tabIndex={-1} className="text-[20px] font-semibold break-words text-ink outline-none">
            {block === undefined ? en.focus.title : <UserText>{block.task_title}</UserText>}
          </h1>
          {block === undefined || KindIcon === null ? null : (
            <p className="flex items-center justify-center gap-1.5 text-small text-ink-muted">
              <KindIcon
                aria-hidden="true"
                size={16}
                strokeWidth={ICON_STROKE}
                className={cx('shrink-0', examColor(block.exam_color_index).text)}
              />
              <span className="min-w-0">{en.focus.meta(block.exam_name, en.board.kinds[block.task_kind])}</span>
            </p>
          )}
        </div>

        {view === 'error' ? (
          <ErrorState
            message={errorMessage(today.error)}
            onRetry={() => {
              void today.refetch()
            }}
          />
        ) : null}

        <div className="flex w-full flex-col gap-2">
          {view === 'five' || view === 'full' ? (
            <>
              {doneButton('secondary')}
              <Button variant="quiet" onPress={stop}>
                {en.focus.stop}
              </Button>
            </>
          ) : null}
          {view === 'over' ? (
            <>
              {doneButton('primary')}
              <Button variant="quiet" onPress={endAndLeave}>
                {en.focus.back}
              </Button>
            </>
          ) : null}
          {view === 'ended' ? (
            <>
              {doneButton('primary')}
              <Button variant="secondary" onPress={leave}>
                {en.focus.back}
              </Button>
            </>
          ) : null}
          {view === 'alreadyDone' || view === 'gone' || view === 'notToday' || view === 'break' ? (
            <Button variant="primary" onPress={leave}>
              {en.focus.back}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// The ring fills over the whole session and never jumps back; the number counts the phase: the five
// minutes, then the rest of the block. The words for a screen reader are the time to the end.
function ProgressTimer({
  view,
  session,
  clock,
  until,
}: {
  view: FocusView
  session: FocusSession
  clock: FocusClock
  until: string
}) {
  const n = minutesLeft(clock.phaseLeftMs)
  const total = minutesLeft(session.endsAt - session.startedAt - clock.elapsedMs)
  return (
    <ProgressRing
      size={208}
      value={clock.elapsedMs}
      max={clock.totalMs}
      aria-label={en.focus.timerLabel}
      valueText={en.focus.valueText(total, until)}
    >
      <span className="flex flex-col items-center gap-1">
        <span className="text-[44px] leading-none font-semibold tabular-nums">{en.focus.minutesLeft(n)}</span>
        <span className="text-small font-normal text-ink-muted">{view === 'five' ? en.focus.ofFive : en.focus.unit(n)}</span>
      </span>
    </ProgressRing>
  )
}
