import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useBlockActions } from '../board/actions'
import { blockName } from '../board/blockName'
import { GRID_MINUTES, moveProblem, snapToGrid, useMoveBlock, type MoveDay } from '../board/move'
import { blockMinutes, formatRange, formatTime } from '../board/time'
import type { Block, BlockState, Today } from '../board/types'
import { codeText } from '../i18n/codes'
import { he } from '../i18n/he'
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

const STATE_STYLE: Record<BlockState, string> = {
  upcoming: 'border-s-brand bg-brand-soft',
  in_progress: 'border-s-brand-strong bg-brand-soft ring-1 ring-brand',
  overdue: 'border-s-warning bg-warning-soft',
  done: 'border-s-success bg-success-soft',
  missed: 'border-s-line bg-surface-muted',
  skipped: 'border-s-line bg-surface-muted',
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

export function DayTimeline({ today, tz, title = he.today.blocks, toolbar }: DayTimelineProps) {
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

  function free(block: Block, start: number) {
    return start === Date.parse(block.starts_at) || moveProblem(block, start, day) === null
  }

  function propose(block: Block, current: Drag, candidate: number) {
    if (candidate === current.candidate) return
    setDrag({ ...current, candidate })
    setAnnouncement(he.move.candidate(rangeOf(candidate, blockMinutes(block), tz), free(block, candidate)))
  }

  function cancel() {
    if (dragRef.current === null) return
    setDrag(null)
    setAnnouncement(he.move.cancelled)
  }

  function finish(block: Block) {
    const current = dragRef.current
    if (current?.id !== block.id) return
    setDrag(null)
    if (current.candidate === current.origin) {
      if (current.mode === 'keyboard') setAnnouncement(he.move.cancelled)
      return
    }
    const problem = moveProblem(block, current.candidate, day)
    if (problem !== null) {
      toast.show({ text: codeText(problem), tone: 'error' })
      setAnnouncement(he.move.refused)
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
    if (mode === 'keyboard') setAnnouncement(he.move.candidate(formatRange(block, tz), true))
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
      const next = snapToGrid(active.candidate + steps * STEP_MS, tz)
      // Not past the edges of the day: the block stops there.
      if (next < bounds.start || next + blockMinutes(block) * MINUTE_MS > bounds.end) return
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
        <h2 id="today-timeline-title" className="text-base font-semibold">
          {title}
        </h2>
        {toolbar}
      </div>
      <p id="timeline-instructions" className="sr-only">
        {he.move.instructions}
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div className="relative overflow-hidden rounded-xl border border-line bg-surface" style={{ height }}>
        {/* The part of the day that already went by. */}
        {now > dayStart ? (
          <div aria-hidden="true" className="absolute inset-x-0 top-0 bg-surface-muted" style={{ height: top(now) }} />
        ) : null}

        {hoursBetween(dayStart, dayEnd, tz).map((hour) => (
          <div key={hour} aria-hidden="true" className="absolute inset-x-0 flex h-0 items-center" style={{ top: top(hour) }}>
            <span dir="ltr" className="w-14 shrink-0 pe-2 text-end text-xs text-ink-muted tabular-nums">
              {formatTime(new Date(hour).toISOString(), tz)}
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
        ))}

        {nowInside ? (
          <div aria-hidden="true" className="absolute inset-x-0 z-20 flex h-0 items-center" style={{ top: top(now) }}>
            <span className="w-14 shrink-0" />
            <span className="-ms-1 size-2 shrink-0 rounded-full bg-danger" />
            <span className="h-0.5 flex-1 bg-danger" />
          </div>
        ) : null}

        <ol ref={listRef} aria-label={he.move.timelineLabel} className="absolute inset-y-0 start-14 end-2">
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
                className={`absolute inset-x-0 z-10 ${moving && ghost !== null ? 'opacity-50' : ''}`}
                style={{ top: blockTop, height: blockHeight }}
              >
                <div
                  className={`flex h-full items-stretch gap-1 overflow-hidden rounded-lg border-s-4 ps-2 ${STATE_STYLE[block.state]} ${moving ? 'ring-2 ring-brand' : ''}`}
                >
                  <div className={`flex min-w-0 flex-1 ${tall ? 'flex-col justify-center gap-0.5 py-1' : 'items-center gap-2'}`}>
                    <p id={titleId} className={`truncate text-sm font-semibold ${done ? 'text-ink-muted line-through' : ''}`}>
                      {block.task_title}
                    </p>
                    <p className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
                      <span dir="ltr" className="tabular-nums">
                        {formatRange(block, tz)}
                      </span>
                      {block.state === 'upcoming' ? null : <span>{he.board.states[block.state]}</span>}
                      {block.pinned ? (
                        <span className="rounded-full border border-line-strong px-1.5 text-[0.7rem] leading-4 font-medium">{he.board.pinned}</span>
                      ) : null}
                    </p>
                  </div>
                  {movable && minutes > 0 ? (
                    <button
                      type="button"
                      data-handle={block.id}
                      aria-label={he.move.handleLabel(blockName(block))}
                      aria-describedby="timeline-instructions"
                      aria-disabled={actions.pending(block.id) || undefined}
                      className="flex w-11 shrink-0 cursor-grab touch-none items-center justify-center text-ink-muted outline-none select-none hover:bg-surface/60 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset active:cursor-grabbing aria-disabled:opacity-50"
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
                    >
                      <GripIcon />
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
            className={`pointer-events-none absolute start-14 end-2 z-30 flex items-center rounded-lg border-2 border-dashed px-3 text-sm font-semibold tabular-nums ${
              ghost.ok ? 'border-success bg-success-soft text-success' : 'border-danger bg-danger-soft text-danger'
            }`}
            style={{
              top: top(ghost.start),
              height: Math.max(blockMinutes(ghost.block) * PX_PER_MINUTE, MIN_BLOCK_PX),
            }}
          >
            <span dir="ltr">{rangeOf(ghost.start, blockMinutes(ghost.block), tz)}</span>
          </div>
        )}
      </div>
    </section>
  )
}

// Six dots: the usual sign of "this can be dragged".
function GripIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 20" className="h-5 w-3" fill="currentColor">
      {[3, 10, 17].map((y) => (
        <g key={y}>
          <circle cx="3" cy={y} r="1.6" />
          <circle cx="9" cy={y} r="1.6" />
        </g>
      ))}
    </svg>
  )
}
