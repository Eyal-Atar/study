import type { BusyItem } from '../availability/types'
import { formatTime } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { StreakLeafIcon, TeaCupIcon } from '../ui/icons'
import { cx } from '../ui/styles'
import { BusyBlock } from './BusyBlock'
import './calendar.css'
import { CalendarBlock, GRID_INSTRUCTIONS_ID } from './CalendarBlock'
import type { CalendarView } from './calendarUrl'
import { weekdayShort } from './days'
import { busyColumn, localMinutes, toPx, type GridSpan } from './geometry'
import type { Ghost } from './ghost'
import { GhostBlock } from './GhostBlock'

// The width of the hours' column, as in the prototype.
const HOURS_PX = 52
// No block is lower than a line of its title: on the night the clocks go back, a block across the
// repeated hour starts and ends at the same wall clock time.
const MIN_BLOCK_PX = 18
// An hour's label this close to "now" gives way to the label of now.
const NOW_CLEARANCE_MIN = 28
// Where "Free day" sits, in hours from the top of the grid (12:30 of the prototype's 08:00 day).
const FREE_DAY_HOURS = 4.5

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
// line of now. The look only: gestures are added on top of it (Task 8).
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
}: TimeGridProps) {
  const height = toPx(span.endMin, span, hourPx)
  const columns = { gridTemplateColumns: `${String(HOURS_PX)}px repeat(${String(days.length)}, minmax(0, 1fr))` }

  // A place on the grid: 1px under the hour's line and 2px short of the next, as in the prototype.
  function place(startMin: number, endMin: number): { top: number; height: number } {
    const top = toPx(startMin, span, hourPx)
    return { top: top + 1, height: Math.max(MIN_BLOCK_PX, toPx(endMin, span, hourPx) - top - 3) }
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
  const visible = blocks.filter((b) => drawn(b) && days.includes(b.study_date))
  const firstY = visible.reduce<number | null>((first, block) => {
    const y = toPx(localMinutes(block.starts_at, block.study_date, tz), span, hourPx)
    return first === null || y < first ? y : first
  }, null)

  const busyByDay = new Map<string, Placed<BusyItem>[]>()
  for (const item of busy) {
    const at = busyColumn(item, days, span, tz)
    if (at === null) continue
    const list = busyByDay.get(at.date) ?? []
    list.push({ item, ...place(at.startMin, at.endMin) })
    busyByDay.set(at.date, list)
  }

  return (
    <div
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
          <div key={date} data-date={date} className={cx('relative border-s border-line', date === today ? 'bg-canvas' : 'bg-surface')} style={{ height }}>
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
                const at = place(localMinutes(block.starts_at, date, tz), localMinutes(block.ends_at, date, tz))
                return (
                  <CalendarBlock
                    key={block.id}
                    block={block}
                    tz={tz}
                    view={view}
                    top={at.top}
                    height={at.height}
                    onOpen={onOpenBlock}
                    leaving={leaving.has(block.id)}
                  />
                )
              })}

            {ghosts
              .filter((ghost) => ghost.date === date && ghost.tone !== 'leaving')
              .map((ghost) => {
                const at = place(ghost.startMin, ghost.endMin)
                return <GhostBlock key={`${ghost.id}-${ghost.tone}`} ghost={ghost} top={at.top} height={at.height} />
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
