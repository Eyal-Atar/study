import { useId } from 'react'
import { errorMessage, type ApiError } from '../api/client'
import { he } from '../i18n/he'
import type { Block } from '../onboarding/types'
import { Button } from '../ui/Button'
import { addDays, dayMonth, weekdayShort } from './dates'
import { minutesByDay, type TimelineRange } from './timelineDays'

const t = he.exam.timeline

// The bar of a day is at most this tall; the busiest day of the range fills it.
const BAR_MAX_PX = 72

interface DayInfo {
  day: string
  planned: number
  done: number
  isToday: boolean
  isRest: boolean
  isExam: boolean
}

function dayLabel(info: DayInfo): string {
  const parts = [t.planned(info.planned)]
  if (info.done > 0) parts.push(t.done(info.done))
  if (info.isToday) parts.push(t.today)
  if (info.isRest) parts.push(t.restDay)
  if (info.isExam) parts.push(t.examDay)
  return `${t.day(weekdayShort(info.day), dayMonth(info.day))}: ${parts.join(', ')}`
}

function Day({ info, max }: { info: DayInfo; max: number }) {
  const plannedPx = info.planned === 0 ? 0 : Math.max(6, Math.round((info.planned / max) * BAR_MAX_PX))
  const donePx = info.planned === 0 ? 0 : Math.round((info.done / info.planned) * plannedPx)
  const column = info.isExam
    ? 'bg-brand text-on-brand'
    : info.isRest
      ? 'bg-surface-muted text-ink-muted'
      : 'text-ink'
  return (
    // The visible column is a picture of the label; a screen reader reads the label once.
    <li aria-label={dayLabel(info)} className={`flex w-11 shrink-0 flex-col items-center gap-1 rounded-lg py-2 ${column}`}>
      <span aria-hidden="true" className={`text-xs ${info.isToday ? 'font-bold text-brand-strong' : ''}`}>
        {info.isToday ? t.today : weekdayShort(info.day)}
      </span>
      <span aria-hidden="true" className="flex w-full flex-col items-center justify-end" style={{ height: BAR_MAX_PX }}>
        {info.isExam ? (
          <span className="text-xs font-medium">{t.examDay}</span>
        ) : info.isRest ? (
          <span className="text-xs">{t.restDay}</span>
        ) : plannedPx > 0 ? (
          <span className="flex w-5 flex-col justify-end overflow-hidden rounded-md bg-brand-soft" style={{ height: plannedPx }}>
            <span className="w-full bg-brand" style={{ height: donePx }} />
          </span>
        ) : (
          <span className="h-1 w-5 rounded-full bg-line" />
        )}
      </span>
      <span
        aria-hidden="true"
        className={`text-xs tabular-nums ${info.isToday ? 'rounded-full bg-brand-soft px-1.5 font-bold text-brand-strong' : ''}`}
      >
        {dayMonth(info.day)}
      </span>
    </li>
  )
}

// The days from today to the exam (plan decision 13): this exam's planned and done minutes per day,
// the rest days, the exam day and today. Scrolls sideways inside its own box, never the page.
export function Timeline({
  examId,
  examDate,
  today,
  restDays,
  range,
  blocks,
  error,
  onRetry,
}: {
  examId: string
  examDate: string
  today: string
  restDays: number
  range: TimelineRange
  blocks: readonly Block[]
  error: ApiError | null
  onRetry: () => void
}) {
  const titleId = useId()
  const minutes = minutesByDay(blocks, examId)
  const firstRest = addDays(examDate, -restDays)
  const days: DayInfo[] = range.days.map((day) => {
    const entry = minutes.get(day)
    return {
      day,
      planned: entry?.planned ?? 0,
      done: entry?.done ?? 0,
      isToday: day === today,
      isRest: restDays > 0 && day >= firstRest && day < examDate,
      isExam: day === examDate,
    }
  })
  const max = Math.max(1, ...days.map((d) => d.planned))

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={titleId} className="text-lg font-medium text-ink">
          {t.title}
        </h2>
        <span aria-hidden="true" className="flex items-center gap-3 text-xs text-ink-muted">
          <span className="flex items-center gap-1">
            <span className="size-3 rounded-sm bg-brand-soft" />
            {t.legendPlanned}
          </span>
          <span className="flex items-center gap-1">
            <span className="size-3 rounded-sm bg-brand" />
            {t.legendDone}
          </span>
        </span>
      </div>
      {error === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-danger">
            {errorMessage(error)}
          </p>
          <Button variant="secondary" onPress={onRetry}>
            {he.common.retry}
          </Button>
        </div>
      )}
      {days.length === 0 ? (
        <p className="text-ink-muted">{t.noDays}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface p-2">
          <ol aria-label={t.listLabel} className="flex gap-1">
            {days.map((info) => (
              <Day key={info.day} info={info} max={max} />
            ))}
          </ol>
        </div>
      )}
      {range.far ? <p className="text-sm text-ink-muted">{t.farNote}</p> : null}
    </section>
  )
}
