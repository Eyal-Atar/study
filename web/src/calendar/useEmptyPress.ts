import { useRef, useState, type PointerEvent } from 'react'
import { GRID_MINUTES } from '../board/move'
import { formatRange } from '../board/time'
import { en } from '../i18n/en'
import { localMinutes, type GridSpan } from './geometry'
import type { Ghost } from './ghost'

// The empty space of a column (S32 decision 15): a press there asks for busy time at that quarter
// hour, for an hour; a mouse drag picks the range, drawn as a ghost of new busy time; a press on an
// hour that has passed does nothing. On a phone a horizontal swipe across the empty space goes to
// the next day (to the left) or the day before (to the right).
//
// The time under the pointer is the clientY from the top of the column and the grid's px per hour.

const MINUTE_MS = 60_000
const MOUSE_SLOP_PX = 4
const TOUCH_SLOP_PX = 8
// A horizontal swipe longer than this changes the day.
const DAY_SWIPE_PX = 60
const PRESS_MINUTES = 60

// What is not empty space: a block, busy time, the buttons of a swipe, any button.
const NOT_EMPTY = '[data-block-id], [data-busy-id], [data-swipe-actions], button'

export interface BusyRange {
  date: string
  // ISO in UTC.
  startsAt: string
  endsAt: string
}

interface Press {
  date: string
  pointerId: number
  touch: boolean
  startX: number
  startY: number
  top: number
  startMin: number
  // The press began on an hour that has passed: it makes no busy time (a swipe still works).
  past: boolean
  range: { lo: number; hi: number } | null
}

export interface EmptyPressHandlers {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
}

export interface EmptyPressInput {
  span: GridSpan
  hourPx: number
  tz: string
  now: number
  onCreateBusy: (range: BusyRange) => void
  onSwipeDay?: ((direction: 1 | -1) => void) | undefined
  // Another gesture is on (a block is being moved, a swipe is open): presses are ignored.
  blocked: () => boolean
}

export interface EmptyPress {
  handlers: (date: string) => EmptyPressHandlers
  ghost: Ghost | null
}

// The instant of a wall clock time of a column: the inverse of localMinutes. Two corrections are
// enough for any offset; the third covers the hour a clock change skips.
export function instantAt(date: string, minutes: number, tz: string): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  let ms = Date.UTC(y, m - 1, d) + minutes * MINUTE_MS
  for (let i = 0; i < 3; i++) {
    const diff = localMinutes(new Date(ms).toISOString(), date, tz) - minutes
    if (diff === 0) break
    ms -= diff * MINUTE_MS
  }
  return ms
}

function floorQuarter(min: number): number {
  return Math.floor(min / GRID_MINUTES) * GRID_MINUTES
}

function ceilQuarter(min: number): number {
  return Math.ceil(min / GRID_MINUTES) * GRID_MINUTES
}

export function useEmptyPress({ span, hourPx, tz, now, onCreateBusy, onSwipeDay, blocked }: EmptyPressInput): EmptyPress {
  const press = useRef<Press | null>(null)
  const [range, setRange] = useState<{ date: string; lo: number; hi: number } | null>(null)

  function minuteAt(current: Press, clientY: number): number {
    return span.startMin + ((clientY - current.top) / hourPx) * 60
  }

  function rangeOf(current: Press, clientY: number): { lo: number; hi: number } {
    // Not above the grid nor below it, and not into the past.
    const nowMin = localMinutes(new Date(now).toISOString(), current.date, tz)
    const at = Math.max(Math.min(Math.max(minuteAt(current, clientY), span.startMin), span.endMin), nowMin)
    const lo = floorQuarter(Math.min(current.startMin, at))
    const hi = Math.max(ceilQuarter(Math.max(current.startMin, at)), lo + GRID_MINUTES)
    return { lo, hi }
  }

  function create(date: string, lo: number, hi: number) {
    onCreateBusy({
      date,
      startsAt: new Date(instantAt(date, lo, tz)).toISOString(),
      endsAt: new Date(instantAt(date, hi, tz)).toISOString(),
    })
  }

  function end() {
    press.current = null
    setRange(null)
  }

  function handlers(date: string): EmptyPressHandlers {
    return {
      onPointerDown: (event) => {
        if (event.button !== 0 || blocked()) return
        if (event.target instanceof Element && event.target.closest(NOT_EMPTY) !== null) return
        const top = event.currentTarget.getBoundingClientRect().top
        const startMin = span.startMin + ((event.clientY - top) / hourPx) * 60
        const touch = event.pointerType === 'touch'
        const past = instantAt(date, startMin, tz) < now
        if (past && !touch) return
        press.current = { date, pointerId: event.pointerId, touch, startX: event.clientX, startY: event.clientY, top, startMin, past, range: null }
        if (touch) return
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // No capture (jsdom, or an old browser): the events still reach the column while over it.
        }
      },
      onPointerMove: (event) => {
        const current = press.current
        if (current?.pointerId !== event.pointerId || current.touch) return
        if (current.range === null && Math.abs(event.clientY - current.startY) <= MOUSE_SLOP_PX) return
        current.range = rangeOf(current, event.clientY)
        setRange({ date: current.date, ...current.range })
      },
      onPointerUp: (event) => {
        const current = press.current
        if (current?.pointerId !== event.pointerId) return
        end()
        const dx = event.clientX - current.startX
        const dy = event.clientY - current.startY
        if (current.touch) {
          if (Math.abs(dx) > DAY_SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
            onSwipeDay?.(dx < 0 ? 1 : -1)
            return
          }
          if (Math.hypot(dx, dy) > TOUCH_SLOP_PX || current.past) return
        } else if (current.range !== null) {
          const picked = rangeOf(current, event.clientY)
          create(current.date, picked.lo, picked.hi)
          return
        } else if (Math.hypot(dx, dy) > MOUSE_SLOP_PX) {
          return
        }
        const start = floorQuarter(current.startMin)
        create(current.date, start, start + PRESS_MINUTES)
      },
      onPointerCancel: (event) => {
        if (press.current?.pointerId === event.pointerId) end()
      },
    }
  }

  const ghost: Ghost | null =
    range === null
      ? null
      : {
          id: 'new-busy',
          date: range.date,
          startMin: range.lo,
          endMin: range.hi,
          colorIndex: null,
          title: en.calendar.grid.newBusy,
          tone: 'target',
          label: formatRange(
            {
              starts_at: new Date(instantAt(range.date, range.lo, tz)).toISOString(),
              ends_at: new Date(instantAt(range.date, range.hi, tz)).toISOString(),
            },
            tz,
          ),
        }

  return { handlers, ghost }
}
