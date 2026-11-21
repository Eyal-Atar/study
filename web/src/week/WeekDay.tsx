import { BlockRow } from '../board/BlockRow'
import { blockMinutes, durationText, formatDay } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { Badge } from '../ui/Badge'
import { List } from '../ui/List'
import { SectionHeading } from '../ui/SectionHeading'

export interface WeekDayProps {
  date: string
  // This day's blocks, already grouped by the server's study_date and sorted by start.
  blocks: Block[]
  tz: string
  isToday: boolean
}

// One day of the week: a section heading on a line (the day, and its total at the end), and under
// it the blocks as rows. There is no box around a day: seven boxes would compete with the rows.
// A free day is the heading line alone, so the busy days stand out when the week is scanned.
// Today is marked by the "היום" badge and aria-current, not by a fill (brand is not a background).
export function WeekDay({ date, blocks, tz, isToday }: WeekDayProps) {
  const headingId = `week-day-${date}`
  const total = blocks.reduce((sum, block) => sum + blockMinutes(block), 0)
  const free = blocks.length === 0

  return (
    <section aria-labelledby={headingId} aria-current={isToday ? 'date' : undefined}>
      {/* The line under the heading is the top line of the first row, as in every list. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line pb-2">
        {/* The badge is inside the heading: the region is named "יום רביעי 18.11 היום". */}
        <SectionHeading id={headingId} className="flex min-w-0 items-center gap-2">
          <span>{formatDay(date)}</span>
          {isToday ? <Badge tone="brand">{en.board.today}</Badge> : null}
        </SectionHeading>
        <p className="text-small text-ink-muted tabular-nums">{free ? en.week.free : en.week.total(durationText(total))}</p>
      </div>
      {free ? null : (
        <List>
          {blocks.map((block) => (
            <BlockRow key={block.id} block={block} tz={tz} />
          ))}
        </List>
      )}
    </section>
  )
}
