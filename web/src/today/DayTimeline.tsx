import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useBlockActions } from '../board/actions'
import { blockName } from '../board/blockName'
import { GRID_MINUTES, moveProblem, snapToGrid, useMoveBlock, type MoveDay } from '../board/move'
import { blockMinutes, formatRange, formatTime } from '../board/time'
import type { Block, BlockState, Today } from '../board/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { GripVertical } from '../ui/icons'
import { PinnedMark } from '../board/blockParts'
import { SectionHeading } from '../ui/SectionHeading'
import { cx, ICON_STROKE } from '../ui/styles'
import { useToast } from '../ui/useToast'

// Today's waking hours as a vertical line of time (S18 decisions 11–12). Every block sits at its
// time; an upcoming one has a handle that moves it in 15-minute steps, by pointer (mouse, touch,
// pen) or by keyboard. The axis is vertical, so RTL needs no flipping: up is earlier everywhere.
//
// The drag reads only clientY deltas and this constant, never the layout (getBoundingClientRect),
// so the same code runs in a browser and in jsdom. Only the handle has `touch-action: none`: a
// finger on the rest of the timeline still scrolls the page.

export const PX_PER_MINUTE = 1.2
const MINUTE_MS = 60_000
const STEP_MS = GRID_MINUTES * MINUTE_MS
// Room above the first hour and below the last, so their labels are not cut.
const EDGE_PX = 12
// A 30-minute block (36px) still shows its title; shorter ones get this much.
const MIN_BLOCK_PX = 32
// Under this height the title and the time share one line.
const TALL_PX = 56
// A pointer has to travel half a step before the block leaves its place.
const DEAD_ZONE_MINUTES = GRID_MINUTES / 2

// A block that waits is white with a line, like a row of the list; a fill is a state (S27
// decision 8). The thick edge at the start repeats the state for a block too short for its word.
const STATE_STYLE: Record<BlockState, string> = {
  upcoming: 'border border-line-strong border-s-4 border-s-brand bg-surface',
  in_progress: 'border-s-4 border-s-brand-strong bg-brand-soft',
  overdue: 'border-s-4 border-s-warning bg-warning-soft',
  done: 'border-s-4 border-s-success bg-success-soft',
  missed: 'border-s-4 border-s-line-strong bg-surface-muted',
  skipped: 'border-s-4 border-s-line-strong bg-surface-muted',
}

// ink-muted is a checked pair on white and on the muted fill only; on a state fill the details
// are ink (design language 2).
const DETAILS_STYLE: Record<BlockState, string> = {
  upcoming: 'text-ink-muted',
  in_progress: 'text-ink',
  overdue: 'text-ink',
  done: 'text-ink',
  missed: 'text-ink-muted',
  skipped: 'text-ink-muted',
}

interface Drag {
  id: string
  // The block's start when the move began, and where it would go now (ms).
  origin: number
  candidate: number
  mode: 'pointer' | 'keyboard'
  pointerId?: number
  startY?: number
}

export interface DayTimelineProps {
  today: Today
  tz: string
  title?: string
  // The view switch, shown next to the heading.
  toolbar?: ReactNode
}

// The full hours of the local clock between two instants.
function hoursBetween(start: number, end: number, tz: string): number[] {
  const minute = Number(formatTime(new Date(start).toISOString(), tz).slice(3))
  const hours: number[] = []
  for (let at = start + ((60 - minute) % 60) * MINUTE_MS; at <= end; at += 60 * MINUTE_MS) hours.push(at)
  return hours
}

function rangeOf(startMs: number, minutes: number, tz: string): string {
  return formatRange(
    { starts_at: new Date(startMs).toISOString(), ends_at: new Date(startMs + minutes * MINUTE_MS).toISOString() },
    tz,
  )
}

export function DayTimeline({ today, tz, title = en.today.blocks, toolbar }: DayTimelineProps) {
  const dayStart = today.day_starts_at === null ? null : Date.parse(today.day_starts_at)
  const dayEnd = today.day_ends_at === null ? null : Date.parse(today.day_ends_at)
  const { move, moving: isMoving } = useMoveBlock()
  const actions = useBlockActions()
  const toast = useToast()
  const [now, setNow] = useState(() => Date.now())
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const listRef = useRef<HTMLOListElement>(null)
  // After a keyboard move the list is sorted again, and a moved DOM node can lose the focus: the
  // handle takes it back from <body>, until the move settled with the focus on it. Focus anywhere
  // else is the user's, and ends the request.
  const refocus = useRef<{ id: string; seen: boolean } | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 30_000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  // The dragged block may stop being movable under the drag: a refetch turns it in_progress, or it
  // is gone. Its handle then unmounts without a pointerup or a blur, so the drag ends here.
  const draggedId = drag?.id
  const draggable =
    draggedId === undefined || today.blocks.some((b) => b.id === draggedId && b.status === 'planned' && b.state === 'upcoming')
  useEffect(() => {
    if (draggable || dragRef.current === null) return
    dragRef.current = null
    setDragState(null)
    setAnnouncement(en.move.cancelled)
  }, [draggable])

  useLayoutEffect(() => {
    const want = refocus.current
    if (want === null) return
    if (isMoving(want.id)) want.seen = true
    const target = listRef.current?.querySelector<HTMLElement>(`[data-handle="${want.id}"]`) ?? null
    const active = document.activeElement
    if (target !== null && (active === null || active === document.body)) {
      target.focus()
      return
    }
    if (target === null || active !== target || (want.seen && !isMoving(want.id))) refocus.current = null
  })

  if (dayStart === null || dayEnd === null || dayEnd <= dayStart) return null

  const blocks = today.blocks
    .filter((b) => b.status === 'planned' || b.status === 'done')
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
  const day: MoveDay = { dayStart, dayEnd, blocks: today.blocks, now }
  // The same bounds, known not to be null inside the handlers below.
  const bounds = { start: dayStart, end: dayEnd }
  const spanMinutes = (dayEnd - dayStart) / MINUTE_MS
  const height = spanMinutes * PX_PER_MINUTE + EDGE_PX * 2
  const top = (ms: number) => EDGE_PX + Math.min(Math.max((ms - dayStart) / MINUTE_MS, 0), spanMinutes) * PX_PER_MINUTE
  const nowInside = now > dayStart && now < dayEnd

  function setDrag(next: Drag | null) {
    dragRef.current = next
    setDragState(next)
  }

  // The first quarter hour a block may start at: not before now, nor before the day starts.
  function earliestStart() {
    const from = Math.max(now, bounds.start)
    const grid = snapToGrid(from, tz)
    return grid < from ? grid + STEP_MS : grid
  }

  function free(block: Block, start: number) {
    return start === Date.parse(block.starts_at) || moveProblem(block, start, day) === null
  }

  function propose(block: Block, current: Drag, candidate: number) {
    if (candidate === current.candidate) return
    setDrag({ ...current, candidate })
    setAnnouncement(en.move.candidate(rangeOf(candidate, blockMinutes(block), tz), free(block, candidate)))
  }

  function cancel() {
    if (dragRef.current === null) return
    setDrag(null)
    setAnnouncement(en.move.cancelled)
  }

  function finish(block: Block) {
    const current = dragRef.current
    if (current?.id !== block.id) return
    setDrag(null)
    if (current.candidate === current.origin) {
      if (current.mode === 'keyboard') setAnnouncement(en.move.cancelled)
      return
    }
    const problem = moveProblem(block, current.candidate, day)
    if (problem !== null) {
      toast.show({ text: codeText(problem), tone: 'error' })
      setAnnouncement(en.move.refused)
      return
    }
    if (current.mode === 'keyboard') refocus.current = { id: block.id, seen: false }
    setAnnouncement('')
    // The handle keeps its own focus (above); a card elsewhere must not take it.
    move(block, new Date(current.candidate).toISOString(), { focus: false })
  }

  function begin(block: Block, mode: Drag['mode'], extra: Partial<Drag> = {}) {
    const origin = Date.parse(block.starts_at)
    setDrag({ id: block.id, origin, candidate: origin, mode, ...extra })
    if (mode === 'keyboard') setAnnouncement(en.move.candidate(formatRange(block, tz), true))
  }

  function onKeyDown(block: Block, event: KeyboardEvent<HTMLButtonElement>) {
    const current = dragRef.current
    const active = current?.id === block.id ? current : null
    if (active === null) {
      if ((event.key === 'Enter' || event.key === ' ') && !actions.pending(block.id)) {
        event.preventDefault()
        begin(block, 'keyboard')
      }
      return
    }
    const steps = { ArrowUp: -1, ArrowDown: 1, PageUp: -4, PageDown: 4 }[event.key]
    if (steps !== undefined) {
      event.preventDefault()
      // Not before now or the start of the day, nor past its end: the block stops there.
      const next = Math.max(snapToGrid(active.candidate + steps * STEP_MS, tz), earliestStart())
      if (steps < 0 && next > active.candidate) return
      if (next + blockMinutes(block) * MINUTE_MS > bounds.end) return
      propose(block, active, next)
      return
    }
    switch (event.key) {
      case 'Enter':
        event.preventDefault()
        finish(block)
        return
      case ' ':
        event.preventDefault()
        return
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        cancel()
        return
      case 'Tab':
        cancel()
    }
  }

  function onPointerDown(block: Block, event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || actions.pending(block.id)) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // No capture (an old browser, or jsdom): the events still reach the handle while over it.
    }
    begin(block, 'pointer', { pointerId: event.pointerId, startY: event.clientY })
  }

  function pointerDrag(block: Block, event: PointerEvent<HTMLButtonElement>): Drag | null {
    const current = dragRef.current
    return current?.id === block.id && current.mode === 'pointer' && current.pointerId === event.pointerId ? current : null
  }

  function onPointerMove(block: Block, event: PointerEvent<HTMLButtonElement>) {
    const current = pointerDrag(block, event)
    if (current === null) return
    const minutes = (event.clientY - (current.startY ?? event.clientY)) / PX_PER_MINUTE
    const candidate = Math.abs(minutes) < DEAD_ZONE_MINUTES ? current.origin : snapToGrid(current.origin + minutes * MINUTE_MS, tz)
    propose(block, current, candidate)
  }

  const dragged = drag === null ? undefined : blocks.find((b) => b.id === drag.id)
  const ghost =
    drag !== null && dragged !== undefined && drag.candidate !== drag.origin
      ? { block: dragged, start: drag.candidate, ok: free(dragged, drag.candidate) }
      : null

  return (
    <section aria-labelledby="today-timeline-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading id="today-timeline-title">{title}</SectionHeading>
        {toolbar}
      </div>
      <p id="timeline-instructions" className="sr-only">
        {en.move.instructions}
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div className="relative overflow-hidden rounded-card border border-line bg-surface" style={{ height }}>
        {hoursBetween(dayStart, dayEnd, tz).map((hour) => (
          <div key={hour} aria-hidden="true" className="absolute inset-x-0 flex h-0 items-center" style={{ top: top(hour) }}>
            <span dir="ltr" className="w-14 shrink-0 pe-2 text-end text-small text-ink-muted tabular-nums">
              {formatTime(new Date(hour).toISOString(), tz)}
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
        ))}

        {/* "You are here" is brand, not an error colour (S27 decision 8). */}
        {nowInside ? (
          <div aria-hidden="true" className="absolute inset-x-0 flex h-0 items-center" style={{ top: top(now) }}>
            <span className="w-14 shrink-0" />
            <span className="-ms-1 size-2 shrink-0 rounded-full bg-brand" />
            <span className="h-0.5 flex-1 bg-brand" />
          </div>
        ) : null}

        <ol ref={listRef} aria-label={en.move.timelineLabel} className="absolute inset-y-0 start-14 end-2">
          {blocks.map((block) => {
            const minutes = blockMinutes(block)
            const blockTop = top(Date.parse(block.starts_at))
            const blockHeight = Math.max(Math.min(top(Date.parse(block.ends_at)), height - EDGE_PX) - blockTop, MIN_BLOCK_PX)
            const tall = blockHeight >= TALL_PX
            const titleId = `timeline-${block.id}-title`
            const movable = block.state === 'upcoming'
            const moving = drag?.id === block.id
            const done = block.state === 'done'
            return (
              <li
                key={block.id}
                aria-labelledby={titleId}
                // opacity-50 marks the block being dragged, not a disabled one (design language 10).
                className={cx('absolute inset-x-0 z-10', moving && ghost !== null && 'opacity-50')}
                style={{ top: blockTop, height: blockHeight }}
              >
                <div
                  className={cx(
                    'flex h-full items-stretch gap-1 overflow-hidden rounded-control ps-3',
                    STATE_STYLE[block.state],
                    moving && 'ring-2 ring-brand ring-inset',
                  )}
                >
                  <div className={cx('flex min-w-0 flex-1', tall ? 'flex-col justify-center' : 'items-center gap-2')}>
                    <p id={titleId} className={cx('truncate text-small', done ? 'font-normal line-through' : 'font-semibold')}>
                      {block.task_title}
                    </p>
                    <p className={cx('text-small whitespace-nowrap', tall ? 'truncate' : 'shrink-0', DETAILS_STYLE[block.state])}>
                      <span dir="ltr" className="tabular-nums">
                        {formatRange(block, tz)}
                      </span>
                      {block.state === 'upcoming' ? null : (
                        <>
                          {en.move.detailsJoiner}
                          <span>{en.board.states[block.state]}</span>
                        </>
                      )}
                      {block.pinned ? (
                        <>
                          {en.move.detailsJoiner}
                          <PinnedMark />
                        </>
                      ) : null}
                    </p>
                  </div>
                  {movable && minutes > 0 ? (
                    // A raw button on purpose: the drag needs the pointer events themselves.
                    <button
                      type="button"
                      data-handle={block.id}
                      aria-label={en.move.handleLabel(blockName(block))}
                      aria-describedby="timeline-instructions"
                      aria-disabled={actions.pending(block.id) || undefined}
                      className="flex w-touch shrink-0 cursor-grab touch-none items-center justify-center text-ink-muted outline-none select-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset active:cursor-grabbing aria-disabled:cursor-not-allowed aria-disabled:text-line-strong aria-disabled:hover:bg-surface"
                      onKeyDown={(event) => {
                        onKeyDown(block, event)
                      }}
                      onBlur={() => {
                        if (dragRef.current?.id === block.id && dragRef.current.mode === 'keyboard') cancel()
                      }}
                      onPointerDown={(event) => {
                        onPointerDown(block, event)
                      }}
                      onPointerMove={(event) => {
                        onPointerMove(block, event)
                      }}
                      onPointerUp={(event) => {
                        if (pointerDrag(block, event) !== null) finish(block)
                      }}
                      onPointerCancel={(event) => {
                        if (pointerDrag(block, event) !== null) cancel()
                      }}
                      // The capture can go without a pointerup (another element took it, the
                      // window lost focus); after a pointerup the drag is already over.
                      onLostPointerCapture={(event) => {
                        if (pointerDrag(block, event) !== null) cancel()
                      }}
                    >
                      <GripVertical aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>

        {ghost === null ? null : (
          <div
            aria-hidden="true"
            data-ghost={ghost.ok ? 'free' : 'taken'}
            className={cx(
              'pointer-events-none absolute start-14 end-2 z-30 flex items-center rounded-control border-2 border-dashed px-3 text-small font-semibold whitespace-nowrap',
              // A taken place is a refusal, so it is danger, and it says so in a word as well.
              ghost.ok ? 'border-success bg-success-soft text-success' : 'border-danger bg-danger-soft text-danger',
            )}
            style={{
              top: top(ghost.start),
              height: Math.max(blockMinutes(ghost.block) * PX_PER_MINUTE, MIN_BLOCK_PX),
            }}
          >
            <span dir="ltr" className="tabular-nums">
              {rangeOf(ghost.start, blockMinutes(ghost.block), tz)}
            </span>
            {en.move.candidateJoiner}
            {en.move.candidateState(ghost.ok)}
          </div>
        )}
      </div>
    </section>
  )
}
