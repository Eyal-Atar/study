import { Fragment, useRef, type CSSProperties } from 'react'
import type { BusyItem } from '../availability/types'
import { blockName } from '../board/blockName'
import { formatTime } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { StreakLeafIcon, TeaCupIcon } from '../ui/icons'
import { useReducedMotion } from '../ui/reducedMotion'
import { cx, FOCUS_RING_NATIVE } from '../ui/styles'
import { BusyBlock } from './BusyBlock'
import './calendar.css'
import { CalendarBlock, GRID_INSTRUCTIONS_ID } from './CalendarBlock'
import type { CalendarView } from './calendarUrl'
import { weekdayShort } from './days'
import { busyColumn, localMinutes, toPx, type GridSpan } from './geometry'
import type { Ghost } from './ghost'
import { GhostBlock } from './GhostBlock'
import { useBlockDrag } from './useBlockDrag'
import { useEmptyPress, type BusyRange } from './useEmptyPress'
import { SWIPE_WIDTH_PX, useSwipe, type SwipeAction } from './useSwipe'

// The width of the hours' column, as in the prototype.
const HOURS_PX = 52
// No block is lower than a line of its title: on the night the clocks go back, a block across the
// repeated hour starts and ends at the same wall clock time.
const MIN_BLOCK_PX = 18
// An hour's label this close to "now" gives way to the label of now.
const NOW_CLEARANCE_MIN = 28
// Where "Free day" sits, in hours from the top of the grid (12:30 of the prototype's 08:00 day).
const FREE_DAY_HOURS = 4.5
// The buttons of a swipe are touch targets even beside a short block.
const SWIPE_MIN_PX = 44
// A block on the move slides back to its place, unless the system asked for less motion.
const SLIDE = 'transform, color, background-color, border-color'

export interface TimeGridProps {
  days: string[]
  today: string
  view: CalendarView
  span: GridSpan
  hourPx: number
  blocks: Block[]
  busy: BusyItem[]
  ghosts: Ghost[]
  tz: string
  now: number
  restDays: Set<string>
  streakDays: Set<string>
  showHeader: boolean
  rangeText: string
  onOpenBlock: (block: Block) => void
  onOpenBusy: (item: BusyItem) => void
  // The waking hours of a study day, for the rules of a move (board/move.ts).
  dayBounds: (date: string) => { dayStart: number | null; dayEnd: number | null }
  onSwipeAction: (block: Block, action: SwipeAction) => void
  // A press or a drag on empty space: busy time to create, in UTC.
  onCreateBusy: (range: BusyRange) => void
  // A swipe across empty space on a phone: 1 is the next day.
  onSwipeDay?: (direction: 1 | -1) => void
}

interface Placed<T> {
  item: T
  top: number
  height: number
}

function drawn(block: Block): boolean {
  return block.status !== 'missed' && block.status !== 'skipped'
}

function hourText(min: number): string {
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:00`
}

// The grid of the calendar, for a week or for one day: the hours, a column for each day, and in
// each column its busy time, its blocks, the ghosts of a change that is being previewed, and the
// line of now. The gestures (Task 8) come from three hooks, wired here: the move of a block
// (useBlockDrag), its swipe (useSwipe), and the empty space (useEmptyPress). One live region says
// every candidate of a move.
//
// For the page's scrolling (Task 13) the grid says where now is (data-now-y, only when today is
// on screen) and where the first block starts (data-first-y), in px from the top of the columns.
export function TimeGrid({
  days,
  today,
  view,
  span,
  hourPx,
  blocks,
  busy,
  ghosts,
  tz,
  now,
  restDays,
  streakDays,
  showHeader,
  rangeText,
  onOpenBlock,
  onOpenBusy,
  dayBounds,
  onSwipeAction,
  onCreateBusy,
  onSwipeDay,
}: TimeGridProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const drag = useBlockDrag({ blocks, busy, tz, now, hourPx, dayBounds, rootRef })
  const swipe = useSwipe(blocks, onSwipeAction)
  const empty = useEmptyPress({
    span,
    hourPx,
    tz,
    now,
    onCreateBusy,
    onSwipeDay,
    blocked: () => drag.busy() || swipe.openId !== null,
  })

  const height = toPx(span.endMin, span, hourPx)
  const columns = { gridTemplateColumns: `${String(HOURS_PX)}px repeat(${String(days.length)}, minmax(0, 1fr))` }

  // A place on the grid: 1px under the hour's line and 2px short of the next, as in the prototype.
  function slot(startMin: number, endMin: number): { top: number; height: number } {
    const top = toPx(startMin, span, hourPx)
    return { top: top + 1, height: toPx(endMin, span, hourPx) - top - 3 }
  }

  // The place of a ghost: never lower than the minimum.
  function place(startMin: number, endMin: number): { top: number; height: number } {
    const at = slot(startMin, endMin)
    return { top: at.top, height: Math.max(MIN_BLOCK_PX, at.height) }
  }

  const nowIso = new Date(now).toISOString()
  const nowMin = localMinutes(nowIso, today, tz)
  const showNow = days.includes(today) && nowMin >= span.startMin && nowMin <= span.endMin
  const nowY = toPx(nowMin, span, hourPx)

  const hours: number[] = []
  for (let min = Math.ceil(span.startMin / 60) * 60 + 60; min < span.endMin; min += 60) {
    if (!showNow || Math.abs(min - nowMin) >= NOW_CLEARANCE_MIN) hours.push(min)
  }
  const lines: number[] = []
  for (let min = Math.ceil(span.startMin / 60) * 60; min < span.endMin; min += 60) lines.push(min)

  const leaving = new Set(ghosts.filter((g) => g.tone === 'leaving').map((g) => g.id))
  // The ghosts of the grid's own gestures have keys of their own: the page may preview a ghost of
  // the same block in the same tone.
  const drawnGhosts = [
    ...ghosts.map((ghost) => ({ ghost, key: `${ghost.id}-${ghost.tone}` })),
    ...(drag.ghost === null ? [] : [{ ghost: drag.ghost, key: `drag-${drag.ghost.id}-${drag.ghost.tone}` }]),
    ...(empty.ghost === null ? [] : [{ ghost: empty.ghost, key: `press-${empty.ghost.id}` }]),
  ]

  // A click that ends a drag or a swipe is not a press on the block. Both are asked, so both forget it.
  function openBlock(block: Block) {
    const afterDrag = drag.consumeClick()
    const afterSwipe = swipe.consumeClick()
    if (afterDrag || afterSwipe) return
    onOpenBlock(block)
  }

  function blockStyle(block: Block): CSSProperties | undefined {
    const dy = drag.offsetY(block.id)
    const dx = swipe.offset(block.id)
    const transform = dy !== 0 ? `translateY(${String(dy)}px)` : dx !== 0 ? `translateX(${String(-dx)}px)` : undefined
    const following = drag.lifted(block.id) || swipe.tracking(block.id)
    const slides = !reducedMotion && !following && (drag.returning === block.id || swipe.settledId === block.id)
    // Above the buttons it uncovers, which are above the other blocks.
    const swiped = dx !== 0 ? { zIndex: 3 } : {}
    if (transform === undefined && !slides && dx === 0) return undefined
    return { ...(transform === undefined ? {} : { transform }), ...(slides ? { transitionProperty: SLIDE } : {}), ...swiped }
  }
  const visible = blocks.filter((b) => drawn(b) && days.includes(b.study_date))
  const firstY = visible.reduce<number | null>((first, block) => {
    const y = toPx(localMinutes(block.starts_at, block.study_date, tz), span, hourPx)
    return first === null || y < first ? y : first
  }, null)

  // Where each block and each busy item of a column truly lies, before a short one is raised.
  const blockSlots = new Map<string, { top: number; height: number }>()
  const topsByDay = new Map<string, number[]>()
  function note(date: string, top: number) {
    const tops = topsByDay.get(date) ?? []
    tops.push(top)
    topsByDay.set(date, tops)
  }
  for (const block of visible) {
    const at = slot(localMinutes(block.starts_at, block.study_date, tz), localMinutes(block.ends_at, block.study_date, tz))
    blockSlots.set(block.id, at)
    note(block.study_date, at.top)
  }
  const busySlots: { item: BusyItem; date: string; top: number; height: number }[] = []
  for (const item of busy) {
    const at = busyColumn(item, days, span, tz)
    if (at === null) continue
    const placed = slot(at.startMin, at.endMin)
    busySlots.push({ item, date: at.date, ...placed })
    note(at.date, placed.top)
  }

  // A short item is raised to the minimum height, but only as far as the next item of its column
  // (a block or busy time), so it neither covers it nor is covered by it; and never below its own
  // height. Never below 1px either: the night the clocks go back, a block's own height can be below
  // zero (it ends before it starts on the wall clock) with another item right under its top.
  function raised(date: string, at: { top: number; height: number }): number {
    let next: number | null = null
    for (const top of topsByDay.get(date) ?? []) {
      if (top > at.top && (next === null || top < next)) next = top
    }
    const room = next === null ? MIN_BLOCK_PX : next - at.top - 3
    return Math.max(1, at.height, Math.min(MIN_BLOCK_PX, room))
  }

  // The buttons of a swipe are SWIPE_WIDTH_PX wide, beside the end of the block, and at least
  // SWIPE_MIN_PX tall. Where they would lie over a neighbour (a week column narrower than they are,
  // or a short block with another item right under it), the block does not swipe: a press opens
  // its actions sheet, which has the same two actions. A width of 0 is a column not laid out yet.
  function swipeFits(date: string, at: { top: number; height: number }, target: Element): boolean {
    const width = target.closest('[data-date]')?.getBoundingClientRect().width ?? 0
    if (width > 0 && width < SWIPE_WIDTH_PX + 6) return false
    const below = at.top + Math.max(at.height, SWIPE_MIN_PX)
    return !(topsByDay.get(date) ?? []).some((top) => top > at.top && top < below)
  }

  const busyByDay = new Map<string, Placed<BusyItem>[]>()
  for (const { item, date, top, height: own } of busySlots) {
    const list = busyByDay.get(date) ?? []
    list.push({ item, top, height: raised(date, { top, height: own }) })
    busyByDay.set(date, list)
  }

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={en.calendar.grid.label(rangeText)}
      data-view={view}
      data-first-y={firstY ?? 0}
      {...(showNow ? { 'data-now-y': nowY } : {})}
      className="group/cal bg-surface"
    >
      <span id={GRID_INSTRUCTIONS_ID} className="sr-only">
        {en.calendar.grid.instructions}
      </span>
      <p role="status" aria-live="polite" className="sr-only">
        {drag.announcement}
      </p>

      {showHeader ? (
        <div data-part="days" className="grid border-b border-line" style={columns}>
          <div />
          {days.map((date) => {
            const isToday = date === today
            return (
              <div key={date} className={cx('pt-2 pb-1 text-center text-caption', isToday ? 'font-semibold text-brand-strong' : 'text-ink-muted')}>
                {weekdayShort(date)}
                <span
                  className={cx(
                    'mx-auto mt-0.5 flex size-8 items-center justify-center rounded-full text-[15px] font-semibold tabular-nums',
                    isToday ? 'bg-brand text-on-brand' : 'text-ink',
                  )}
                >
                  {Number(date.slice(8))}
                </span>
                {isToday ? <span className="sr-only">{en.calendar.grid.today}</span> : null}
                <span className="flex h-3.5 items-center justify-center text-brand-strong">
                  {streakDays.has(date) ? (
                    <>
                      <StreakLeafIcon size={13} />
                      <span className="sr-only">{en.calendar.grid.streakDay}</span>
                    </>
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="grid" style={columns}>
        <div aria-hidden="true" className="relative" style={{ height }}>
          {hours.map((min) => (
            <span
              key={min}
              className="absolute end-2 -translate-y-2 text-caption text-ink-muted tabular-nums"
              style={{ top: toPx(min, span, hourPx) }}
            >
              {hourText(min)}
            </span>
          ))}
          {showNow ? (
            <span
              className="absolute end-1 z-[6] -translate-y-1/2 rounded-[5px] bg-surface px-1 py-px text-caption font-bold text-now-text tabular-nums"
              style={{ top: nowY }}
            >
              {formatTime(nowIso, tz)}
            </span>
          ) : null}
        </div>

        {days.map((date) => (
          <div
            key={date}
            data-date={date}
            // pan-y: the day scrolls under a finger, and a sideways swipe is the grid's (Task 8).
            className={cx('relative touch-pan-y border-s border-line', date === today ? 'bg-canvas' : 'bg-surface')}
            style={{ height }}
            {...empty.handlers(date)}
            onLostPointerCapture={empty.handlers(date).onPointerCancel}
          >
            {lines.map((min) => (
              <div key={min} className="absolute inset-x-0 border-t border-line" style={{ top: toPx(min, span, hourPx) }} />
            ))}

            {restDays.has(date) ? (
              <div
                className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-1 text-caption text-ink-muted"
                style={{ top: Math.min(FREE_DAY_HOURS * hourPx, height / 2) }}
              >
                <TeaCupIcon size={20} />
                {en.calendar.grid.freeDay}
              </div>
            ) : null}

            {(busyByDay.get(date) ?? []).map(({ item, top, height: h }) => (
              <BusyBlock key={`${item.source}-${item.id}-${item.starts_at}`} item={item} tz={tz} top={top} height={h} onOpen={onOpenBusy} />
            ))}

            {visible
              .filter((block) => block.study_date === date)
              .map((block) => {
                const own = blockSlots.get(block.id) ?? slot(localMinutes(block.starts_at, date, tz), localMinutes(block.ends_at, date, tz))
                const at = { top: own.top, height: raised(date, own) }
                const moves = drag.handlers(block)
                const swipes = swipe.handlers(block)
                const name = blockName(block)
                const style = blockStyle(block)
                return (
                  <Fragment key={block.id}>
                    {swipe.offset(block.id) > 0 ? (
                      <div
                        data-swipe-actions={block.id}
                        className="absolute end-[3px] z-[2] flex overflow-hidden rounded-[10px]"
                        style={{ top: at.top, height: Math.max(at.height, SWIPE_MIN_PX), width: SWIPE_WIDTH_PX }}
                      >
                        <button
                          type="button"
                          aria-label={en.board.deferLabel(name)}
                          onClick={() => {
                            swipe.act(block, 'defer')
                          }}
                          className={cx('flex-1 bg-gold text-small font-semibold text-ink', FOCUS_RING_NATIVE)}
                        >
                          {en.board.defer}
                        </button>
                        <button
                          type="button"
                          aria-label={en.review.skipLabel(name)}
                          onClick={() => {
                            swipe.act(block, 'skip')
                          }}
                          className={cx('flex-1 bg-clay text-small font-semibold text-on-clay', FOCUS_RING_NATIVE)}
                        >
                          {en.review.skip}
                        </button>
                      </div>
                    ) : null}
                    <CalendarBlock
                      block={block}
                      tz={tz}
                      view={view}
                      top={at.top}
                      height={at.height}
                      onOpen={openBlock}
                      leaving={leaving.has(block.id)}
                      lifted={drag.lifted(block.id)}
                      {...(style === undefined ? {} : { style })}
                      gestures={{
                        onPointerDown: (event) => {
                          // An open swipe takes the press: it closes, and does not lift the block.
                          if (swipe.openId !== block.id) moves.onPointerDown(event)
                          if (swipeFits(date, at, event.currentTarget)) swipes.onPointerDown(event)
                          else swipe.clearClick()
                        },
                        onPointerMove: (event) => {
                          moves.onPointerMove(event)
                          if (!drag.lifted(block.id)) swipes.onPointerMove(event)
                        },
                        onPointerUp: (event) => {
                          moves.onPointerUp(event)
                          swipes.onPointerUp(event)
                        },
                        onPointerCancel: (event) => {
                          moves.onPointerCancel(event)
                          swipes.onPointerCancel(event)
                        },
                        onLostPointerCapture: moves.onLostPointerCapture,
                        onKeyDown: (event) => {
                          swipe.clearClick()
                          moves.onKeyDown(event)
                        },
                        onBlur: moves.onBlur,
                      }}
                    />
                  </Fragment>
                )
              })}

            {drawnGhosts
              .filter(({ ghost }) => ghost.date === date && ghost.tone !== 'leaving')
              .map(({ ghost, key }) => {
                const at = place(ghost.startMin, ghost.endMin)
                return <GhostBlock key={key} ghost={ghost} top={at.top} height={at.height} />
              })}

            {showNow && date === today ? (
              <div data-now-line="" className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-now" style={{ top: nowY }}>
                <span className="absolute -start-[5px] -top-[6px] size-[10px] rounded-full bg-now" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
