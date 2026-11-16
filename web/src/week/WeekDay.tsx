import { BlockCard } from '../board/BlockCard'
import { blockMinutes, durationText, formatDay } from '../board/time'
import type { Block } from '../board/types'
import { he } from '../i18n/he'

export interface WeekDayProps {
  date: string
  // This day's blocks, already grouped by the server's study_date and sorted by start.
  blocks: Block[]
  tz: string
  isToday: boolean
}

// One day of the week: a heading, the day's total, and its blocks as compact rows.
// A free day stays one quiet line, so the busy days stand out when the week is scanned.
export function WeekDay({ date, blocks, tz, isToday }: WeekDayProps) {
  const headingId = `week-day-${date}`
  const total = blocks.reduce((sum, block) => sum + blockMinutes(block), 0)
  const free = blocks.length === 0

  return (
    <section
      aria-labelledby={headingId}
      aria-current={isToday ? 'date' : undefined}
      className={`rounded-xl border bg-surface ${isToday ? 'border-brand border-s-4' : 'border-line'}`}
    >
      <div className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 ${isToday ? 'rounded-t-xl bg-brand-soft' : ''}`}>
        <h2 id={headingId} className="flex items-center gap-2 font-semibold">
          <span>{formatDay(date)}</span>
          {isToday ? (
            <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-on-brand">{he.board.today}</span>
          ) : null}
        </h2>
        {free ? (
          <p className="text-sm text-ink-muted">{he.week.free}</p>
        ) : (
          <p className="text-sm text-ink-muted tabular-nums">{he.week.total(durationText(total))}</p>
        )}
      </div>
      {free ? null : (
        <ul className="space-y-2 px-3 pb-3">
          {blocks.map((block) => (
            <li key={block.id}>
              <BlockCard block={block} tz={tz} variant="compact" />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
