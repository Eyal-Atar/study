import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { BusyItem } from '../availability/types'
import { useBlockActions } from '../board/actions'
import { GRID_MINUTES, moveProblem, snapToGrid, useMoveBlock, type MoveDay, type MoveProblem } from '../board/move'
import { blockMinutes, formatRange } from '../board/time'
import type { Block } from '../board/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { useToast } from '../ui/useToast'
import { ghostOf, type Ghost } from './ghost'

// Moving a block on the calendar's grid (S32 decisions 8–9), by mouse, pen, touch or keyboard,
// within its own column: a move never changes the day. The rules of the move are board/move.ts's
// (moveProblem, snapToGrid, useMoveBlock), the same as the timeline of S18; this hook only turns a
// gesture into a candidate start, draws it as a ghost, says it in the live region, and on release
// either asks for the move or says why not.
//
// - Mouse and pen: the drag starts after 4px of vertical travel from the press; less is a press,
//   and the click that follows opens the block.
// - Touch: a long press of 350ms that moved no more than 8px; a finger that moves before that is
//   scrolling (or swiping, useSwipe.ts). Once the drag started, a non-passive touchmove listener
//   on the document stops the page from scrolling under it.
// - Keyboard: an arrow or Page key on a focused block starts the move and takes the first step.
//
// The pointer is read as clientY deltas from the press and the grid's px per hour, never the
// layout, so the same code runs in a browser and in jsdom. Every listener this hook puts on the
// document is taken off when the gesture ends and on unmount.

const MINUTE_MS = 60_000
const STEP_MS = GRID_MINUTES * MINUTE_MS
// Vertical travel before a mouse or pen press becomes a drag.
const MOUSE_SLOP_PX = 4
// How far a finger may wander during the long press.
const TOUCH_SLOP_PX = 8
export const LONG_PRESS_MS = 350

interface Drag {
  id: string
  // The block's start when the move began, and where it would go now (ms).
  origin: number
  candidate: number
  mode: 'pointer' | 'keyboard'
  pointerId?: number
  startY?: number
  // How far the pointer moved the lifted block, in px.
  dy: number
}

interface Pending {
  id: string
  pointerId: number
  startX: number
  startY: number
  touch: boolean
  timer: number | null
}

export interface BlockDragHandlers {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void
  onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onBlur: (event: FocusEvent<HTMLDivElement>) => void
}

export interface BlockDragInput {
  blocks: Block[]
  busy: BusyItem[]
  tz: string
  now: number
  hourPx: number
  dayBounds: (date: string) => { dayStart: number | null; dayEnd: number | null }
  // The grid: after a keyboard move the focus goes back to the block inside it.
  rootRef: RefObject<HTMLElement | null>
}

export interface BlockDrag {
  handlers: (block: Block) => BlockDragHandlers
  // The ghost at the candidate, while a move is on.
  ghost: Ghost | null
  announcement: string
  // A block held by a pointer drag, and how far it was carried.
  lifted: (blockId: string) => boolean
  offsetY: (blockId: string) => number
  // The block that last went back to its place (it may slide there).
  returning: string | null
  // A move (or a press that may become one) is on: the empty space ignores presses meanwhile.
  busy: () => boolean
  // The click that ends a drag is not a press on the block: true once after a drag.
  consumeClick: () => boolean
}

function movable(block: Block): boolean {
  return block.status === 'planned' && block.state === 'upcoming'
}

function rangeOf(startMs: number, minutes: number, tz: string): string {
  return formatRange({ starts_at: new Date(startMs).toISOString(), ends_at: new Date(startMs + minutes * MINUTE_MS).toISOString() }, tz)
}

export function useBlockDrag({ blocks, busy, tz, now, hourPx, dayBounds, rootRef }: BlockDragInput): BlockDrag {
  const { move, moving: isMoving } = useMoveBlock()
  const actions = useBlockActions()
  const toast = useToast()
  const [drag, setDragState] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const pending = useRef<Pending | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [returning, setReturning] = useState<string | null>(null)
  const swallowClick = useRef(false)
  const listeners = useRef<(() => void)[]>([])
  // After a keyboard move the focus stays on the block (the mechanism of today/DayTimeline): if the
  // block's element is replaced and the focus falls to <body>, it takes it back, until the move
  // settled with the focus on it. Focus anywhere else is the user's, and ends the request.
  const refocus = useRef<{ id: string; seen: boolean } | null>(null)

  function setDrag(next: Drag | null) {
    dragRef.current = next
    setDragState(next)
  }

  function listen(target: Document | Window, type: string, listener: (event: Event) => void, options?: AddEventListenerOptions) {
    target.addEventListener(type, listener, options)
    listeners.current.push(() => {
      target.removeEventListener(type, listener, options)
    })
  }

  function unlisten() {
    for (const remove of listeners.current.splice(0)) remove()
  }

  function clearPending() {
    const current = pending.current
    if (current?.timer != null) window.clearTimeout(current.timer)
    pending.current = null
  }

  // On unmount: no listener and no timer is left behind.
  useEffect(
    () => () => {
      for (const remove of listeners.current.splice(0)) remove()
      const current = pending.current
      if (current?.timer != null) window.clearTimeout(current.timer)
      pending.current = null
    },
    [],
  )

  // The dragged block may stop being movable under the drag: a refetch turns it in_progress, or it
  // is gone. The drag then ends here, with no request (Review Focus 2).
  const draggedId = drag?.id
  const draggable = draggedId === undefined || blocks.some((b) => b.id === draggedId && movable(b))
  useEffect(() => {
    if (draggable || dragRef.current === null) return
    unlisten()
    dragRef.current = null
    setDragState(null)
    setAnnouncement(en.move.cancelled)
  }, [draggable])

  useLayoutEffect(() => {
    const want = refocus.current
    if (want === null) return
    if (isMoving(want.id)) want.seen = true
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-block-id="${want.id}"]`) ?? null
    const active = document.activeElement
    if (target !== null && (active === null || active === document.body)) {
      target.focus()
      return
    }
    if (target === null || active !== target || (want.seen && !isMoving(want.id))) refocus.current = null
  })

  function moveDay(block: Block): MoveDay {
    return { ...dayBounds(block.study_date), blocks: blocks.filter((b) => b.study_date === block.study_date), busy, now }
  }

  function problemAt(block: Block, current: Drag, candidate: number): MoveProblem | null {
    return candidate === current.origin ? null : moveProblem(block, candidate, moveDay(block))
  }

  function say(block: Block, current: Drag, candidate: number) {
    const problem = problemAt(block, current, candidate)
    setAnnouncement(en.calendar.grid.candidate(rangeOf(candidate, blockMinutes(block), tz), en.calendar.grid.problem[problem ?? 'free']))
  }

  function propose(block: Block, current: Drag, candidate: number, dy = current.dy) {
    if (candidate === current.candidate && dy === current.dy) return
    setDrag({ ...current, candidate, dy })
    if (candidate !== current.candidate) say(block, current, candidate)
  }

  function end() {
    unlisten()
    setDrag(null)
  }

  function cancel() {
    const current = dragRef.current
    if (current === null) return
    end()
    setReturning(current.id)
    setAnnouncement(en.move.cancelled)
  }

  function finish(block: Block) {
    const current = dragRef.current
    if (current?.id !== block.id) return
    end()
    if (current.candidate === current.origin) {
      setReturning(block.id)
      if (current.mode === 'keyboard') setAnnouncement(en.move.cancelled)
      return
    }
    const problem = moveProblem(block, current.candidate, moveDay(block))
    if (problem !== null) {
      setReturning(block.id)
      toast.show({ text: codeText(problem), tone: 'error' })
      setAnnouncement(en.move.refused)
      return
    }
    // Lands where it was dropped: no slide back.
    setReturning(null)
    if (current.mode === 'keyboard') refocus.current = { id: block.id, seen: false }
    setAnnouncement('')
    // The block keeps its own focus (above); a card elsewhere must not take it.
    move(block, new Date(current.candidate).toISOString(), { focus: false })
  }

  function canStart(block: Block): boolean {
    return dragRef.current === null && movable(block) && !actions.pending(block.id)
  }

  function beginPointer(block: Block, press: Pending) {
    const origin = Date.parse(block.starts_at)
    swallowClick.current = true
    setReturning(null)
    setDrag({ id: block.id, origin, candidate: origin, mode: 'pointer', pointerId: press.pointerId, startY: press.startY, dy: 0 })
    listen(document, 'keydown', (event) => {
      if ((event as globalThis.KeyboardEvent).key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancel()
    })
    if (press.touch) {
      // The page must not scroll under a finger that holds a block.
      listen(
        document,
        'touchmove',
        (event) => {
          event.preventDefault()
        },
        { passive: false },
      )
    }
  }

  function earliestStart(block: Block) {
    const { dayStart } = dayBounds(block.study_date)
    const from = Math.max(now, dayStart ?? now)
    const grid = snapToGrid(from, tz)
    return grid < from ? grid + STEP_MS : grid
  }

  function step(block: Block, current: Drag, steps: number) {
    // Not before now or the start of the day, nor past its end: the block stops there.
    const next = Math.max(snapToGrid(current.candidate + steps * STEP_MS, tz), earliestStart(block))
    if (steps < 0 && next > current.candidate) return
    const { dayEnd } = dayBounds(block.study_date)
    if (dayEnd !== null && next + blockMinutes(block) * MINUTE_MS > dayEnd) return
    propose(block, current, next)
  }

  function pointerDrag(block: Block, event: PointerEvent): Drag | null {
    const current = dragRef.current
    return current?.id === block.id && current.mode === 'pointer' && current.pointerId === event.pointerId ? current : null
  }

  function pendingOf(block: Block, event: PointerEvent): Pending | null {
    const current = pending.current
    return current?.id === block.id && current.pointerId === event.pointerId ? current : null
  }

  function handlers(block: Block): BlockDragHandlers {
    return {
      onPointerDown: (event) => {
        swallowClick.current = false
        if (event.button !== 0 || !canStart(block)) return
        clearPending()
        const press: Pending = {
          id: block.id,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          touch: event.pointerType === 'touch',
          timer: null,
        }
        pending.current = press
        if (press.touch) {
          press.timer = window.setTimeout(() => {
            if (pending.current !== press) return
            pending.current = null
            if (canStart(block)) beginPointer(block, press)
          }, LONG_PRESS_MS)
          return
        }
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // No capture (jsdom, or an old browser): the events still reach the block while over it.
        }
      },
      onPointerMove: (event) => {
        const current = pointerDrag(block, event)
        if (current !== null) {
          const dy = event.clientY - (current.startY ?? event.clientY)
          propose(block, current, snapToGrid(current.origin + (dy / hourPx) * 60 * MINUTE_MS, tz), dy)
          return
        }
        const press = pendingOf(block, event)
        if (press === null) return
        const dx = event.clientX - press.startX
        const dy = event.clientY - press.startY
        if (press.touch) {
          // A finger that moves before the long press is scrolling or swiping.
          if (Math.hypot(dx, dy) > TOUCH_SLOP_PX) clearPending()
          return
        }
        if (Math.abs(dy) <= MOUSE_SLOP_PX) return
        clearPending()
        beginPointer(block, press)
        const started = dragRef.current
        if (started !== null) propose(block, started, snapToGrid(started.origin + (dy / hourPx) * 60 * MINUTE_MS, tz), dy)
      },
      onPointerUp: (event) => {
        if (pointerDrag(block, event) !== null) finish(block)
        else if (pendingOf(block, event) !== null) clearPending()
      },
      onPointerCancel: (event) => {
        if (pointerDrag(block, event) !== null) cancel()
        else if (pendingOf(block, event) !== null) clearPending()
      },
      // The capture can go without a pointerup (another element took it, the window lost focus);
      // after a pointerup the drag is already over.
      onLostPointerCapture: (event) => {
        if (pointerDrag(block, event) !== null) cancel()
      },
      onKeyDown: (event) => {
        swallowClick.current = false
        if (event.target !== event.currentTarget) return
        const current = dragRef.current
        const active = current?.id === block.id && current.mode === 'keyboard' ? current : null
        const steps = ({ ArrowUp: -1, ArrowDown: 1, PageUp: -4, PageDown: 4 } as Record<string, number | undefined>)[event.key]
        if (active === null) {
          if (steps === undefined || !canStart(block)) return
          event.preventDefault()
          const origin = Date.parse(block.starts_at)
          const started: Drag = { id: block.id, origin, candidate: origin, mode: 'keyboard', dy: 0 }
          setReturning(null)
          setDrag(started)
          step(block, started, steps)
          return
        }
        if (steps !== undefined) {
          event.preventDefault()
          step(block, active, steps)
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
      },
      onBlur: () => {
        const current = dragRef.current
        if (current?.id === block.id && current.mode === 'keyboard') cancel()
      },
    }
  }

  const dragged = drag === null ? undefined : blocks.find((b) => b.id === drag.id)
  let ghost: Ghost | null = null
  if (drag !== null && dragged !== undefined && (drag.mode === 'pointer' || drag.candidate !== drag.origin)) {
    const minutes = blockMinutes(dragged)
    const startsAt = new Date(drag.candidate).toISOString()
    const endsAt = new Date(drag.candidate + minutes * MINUTE_MS).toISOString()
    const range = rangeOf(drag.candidate, minutes, tz)
    const problem = problemAt(dragged, drag, drag.candidate)
    ghost =
      problem === null
        ? ghostOf(dragged, startsAt, endsAt, dragged.study_date, tz, 'target', range)
        : ghostOf(dragged, startsAt, endsAt, dragged.study_date, tz, 'problem', en.calendar.grid.candidate(range, en.calendar.grid.problem[problem]))
  }

  return {
    handlers,
    ghost,
    announcement,
    lifted: (blockId) => drag?.id === blockId && drag.mode === 'pointer',
    offsetY: (blockId) => (drag?.id === blockId && drag.mode === 'pointer' ? drag.dy : 0),
    returning,
    busy: () => dragRef.current !== null || pending.current !== null,
    consumeClick: () => {
      const swallow = swallowClick.current
      swallowClick.current = false
      return swallow
    },
  }
}
