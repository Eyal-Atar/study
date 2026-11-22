import { dayLabel, formatTime } from '../board/time'
import type { Block, Plan, Today } from '../board/types'
import { en } from '../i18n/en'
import { nextLater, nextToday } from '../today/chooseNext'
import { Button } from '../ui/Button'
import { CalendarClock, FreeTimeIcon } from '../ui/icons'
import { ProgressRing } from '../ui/ProgressRing'
import { ICON_STROKE } from '../ui/styles'
import { archiLine, MOMENT_MOOD, type ArchiMoment } from './archi'
import { ArchiSays } from './ArchiSays'
import { ExamsList, type SidebarExam } from './ExamsList'
import { NextCard } from './NextCard'
import { TodayTasks } from './TodayTasks'

export interface SidebarProps {
  todayData: Today
  // The calendar's range: where the next block is looked for when today has none left.
  plan: Plan | undefined
  exams: SidebarExam[]
  tz: string
  moment: ArchiMoment
  onFreeTime: () => void
  onMarkBusy: () => void
  onDefer: (block: Block) => void
  onOpenBlock: (block: Block) => void
}

// A block that went by or was given up is not part of what the day still holds.
const counts = (block: Block) => block.state !== 'missed' && block.state !== 'skipped'

// The side panel of the calendar on a computer (the .side of the prototype): Archi opens the day
// in his own words, standing on the card of the next block; under them the minutes of today, the
// two ways to change the day, the rest of today's blocks, and the coming exams.
export function Sidebar({ todayData, plan, exams, tz, moment, onFreeTime, onMarkBusy, onDefer, onOpenBlock }: SidebarProps) {
  const today = todayData.date
  const counted = todayData.blocks.filter(counts)
  const next = nextToday(todayData.blocks)
  const later = next === undefined && plan !== undefined ? nextLater(plan.blocks, today) : undefined
  const line = archiLine(moment, today, {
    total: counted.length,
    done: counted.filter((block) => block.state === 'done').length,
    next: next === undefined ? null : formatTime(next.starts_at, tz),
  })
  // Only on a day that has no block at all (as the old today screen did): a finished day had blocks. On a
  // rest day and on an open day Archi's own line already says it, so it is not said twice.
  const noBlocksLine =
    later !== undefined && todayData.blocks.length === 0 && moment !== 'restDay' && moment !== 'openDay'
  const done = todayData.done_minutes
  // planned_minutes is what is left (plan_views.py sums the planned blocks only), so the day is both.
  const total = todayData.planned_minutes + todayData.done_minutes
  const percent = total <= 0 ? 0 : Math.round((Math.min(Math.max(done, 0), total) / total) * 100)
  return (
    <aside
      aria-label={en.today.title}
      // 14px is the size of the prototype's desktop; Archi's line and the name on the card set their own.
      className="flex w-[300px] shrink-0 flex-col gap-3.5 overflow-y-auto border-e border-line bg-surface px-4 pt-3.5 pb-3 text-small"
    >
      {/* No gap between the two: Archi's feet are on the upper edge of the card. */}
      <div>
        <ArchiSays mood={MOMENT_MOOD[moment]}>
          {line}
          {noBlocksLine ? (
            <span className="mt-1 block text-small font-normal text-ink-muted">{en.today.noBlocksToday}</span>
          ) : null}
        </ArchiSays>
        {next !== undefined ? <NextCard block={next} tz={tz} onDefer={onDefer} /> : null}
        {later !== undefined ? (
          <NextCard
            block={later}
            tz={tz}
            when={en.today.nextAt(dayLabel(later.study_date, today), formatTime(later.starts_at, tz))}
            onDefer={onDefer}
          />
        ) : null}
      </div>
      {total > 0 ? (
        <div className="flex items-center gap-3">
          <ProgressRing value={done} max={total} aria-label={en.today.progressLabel} valueText={en.today.progress(done, total)}>
            {/* The meter already says the value: the number in its centre is for the eye. */}
            <span aria-hidden="true">{`${String(percent)}%`}</span>
          </ProgressRing>
          <div className="min-w-0">
            <p className="font-semibold tabular-nums">{en.today.progress(done, total)}</p>
            <p className="text-small text-ink-muted">{en.today.progressLabel}</p>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Button variant="secondary" className="w-full" onPress={onFreeTime}>
          <FreeTimeIcon size={18} className="text-brand-strong" />
          {en.calendar.side.freeTime}
        </Button>
        <Button variant="secondary" className="w-full" onPress={onMarkBusy}>
          <CalendarClock aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="text-ink-muted" />
          {en.calendar.side.markBusy}
        </Button>
      </div>
      <TodayTasks
        blocks={counted.filter((block) => block.id !== next?.id)}
        tz={tz}
        heading={en.today.moreBlocks}
        onOpenBlock={onOpenBlock}
      />
      <ExamsList exams={exams} today={today} />
    </aside>
  )
}
