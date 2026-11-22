import { Flag, TeaCupIcon } from '../ui/icons'
import { useId } from 'react'
import { errorMessage, type ApiError } from '../api/client'
import { en } from '../i18n/en'
import type { Block } from '../onboarding/types'
import { examColor } from '../ui/examColor'
import { ErrorState } from '../ui/states'
import { cx, ICON_STROKE } from '../ui/styles'
import { addDays, dayMonth, weekdayShort } from './dates'
import { minutesByDay, type TimelineRange } from './timelineDays'

const t = en.exam.timeline

// The bar of a day is at most this tall; the busiest day of the range fills it.
const BAR_MAX_PX = 72
// The shortest bar: its outline alone takes 2px, and the done part has to show inside it.
const BAR_MIN_PX = 8

// A planned day is a bar in the soft colour of the exam with its line, and the part that was done
// fills it from the bottom in green: green is "done" everywhere, the exam's colour is "planned for
// this exam". The green is bg-success (the brand-strong green); there is no brand-ink fill.
const PLANNED_BASE = 'border'
const DONE = 'bg-success'

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

function Day({ info, max, colour }: { info: DayInfo; max: number; colour: ReturnType<typeof examColor> }) {
  const planned = cx(PLANNED_BASE, colour.soft, colour.line)
  const plannedPx = info.planned === 0 ? 0 : Math.max(BAR_MIN_PX, Math.round((info.planned / max) * BAR_MAX_PX))
  const donePx = info.planned === 0 ? 0 : Math.round((info.done / info.planned) * plannedPx)
  return (
    // The visible column is a picture of the label; a screen reader reads the label once.
    <li aria-label={dayLabel(info)} className="flex shrink-0 basis-1/7 snap-start flex-col items-center gap-1 py-2">
      {/* "Today" in words, not only in colour. */}
      <span
        aria-hidden="true"
        className={cx('text-caption whitespace-nowrap', info.isToday ? 'font-semibold text-brand-strong' : 'text-ink-muted')}
      >
        {info.isToday ? t.today : weekdayShort(info.day)}
      </span>
      <span aria-hidden="true" className="flex w-full items-end justify-center" style={{ height: BAR_MAX_PX }}>
        {info.isExam ? (
          // An icon and no words: "Exam day" does not fit a narrow column, and used to wrap.
          <Flag aria-hidden="true" data-mark="exam" size={18} strokeWidth={ICON_STROKE} className={colour.text} />
        ) : info.isRest ? (
          <span data-mark="rest" className="text-ink-muted">
            <TeaCupIcon size={18} />
          </span>
        ) : plannedPx > 0 ? (
          <span data-mark="planned" className={cx('flex w-5 flex-col justify-end overflow-hidden rounded-badge', planned)} style={{ height: plannedPx }}>
            {donePx > 0 ? <span data-mark="done" className={cx('w-full', DONE)} style={{ height: donePx }} /> : null}
          </span>
        ) : (
          <span data-mark="none" className="h-1 w-5 rounded-full bg-line" />
        )}
      </span>
      <span aria-hidden="true" className="text-caption whitespace-nowrap tabular-nums text-ink-muted">
        {dayMonth(info.day)}
      </span>
    </li>
  )
}

// The four signs of the chart, with their words. Hidden from screen readers: every day carries
// its full label.
function Legend({ colour }: { colour: ReturnType<typeof examColor> }) {
  const item = 'flex items-center gap-1'
  return (
    <span aria-hidden="true" data-legend="" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-muted">
      <span className={item}>
        <span className={cx('size-3 rounded-badge', PLANNED_BASE, colour.soft, colour.line)} />
        {t.legendPlanned}
      </span>
      <span className={item}>
        <span className={cx('size-3 rounded-badge', DONE)} />
        {t.legendDone}
      </span>
      <span className={item}>
        <TeaCupIcon aria-hidden="true" size={14} strokeWidth={ICON_STROKE} />
        {t.legendRest}
      </span>
      <span className={item}>
        <Flag aria-hidden="true" size={14} strokeWidth={ICON_STROKE} className={colour.text} />
        {t.legendExam}
      </span>
    </span>
  )
}

// The days from today to the exam (plan decision 13): this exam's planned and done minutes per day,
// the rest days, the exam day and today. Scrolls sideways inside its own box, never the page. The
// days are in date order in the DOM, so in LTR today is at the left, where the scroll starts.
// Soft edges that show only on the side that has more days (the "local" background scrolls with the
// content and covers the shade, the "scroll" one stays on the box edge): the cue that the row scrolls.
const SCROLL_CUE = {
  backgroundImage:
    'linear-gradient(to right, var(--color-surface), var(--color-surface)), linear-gradient(to left, var(--color-surface), var(--color-surface)), linear-gradient(to right, rgb(0 0 0 / 0.14), transparent), linear-gradient(to left, rgb(0 0 0 / 0.14), transparent)',
  backgroundPosition: '0 50%, 100% 50%, 0 50%, 100% 50%',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '24px 100%, 24px 100%, 12px 100%, 12px 100%',
  backgroundAttachment: 'local, local, scroll, scroll',
} as const

export function Timeline({
  examId,
  colorIndex,
  percent,
  examDate,
  today,
  restDays,
  range,
  blocks,
  error,
  onRetry,
}: {
  examId: string
  // The colour of the exam (planned days, the flag), and how much of its plan is done, in percent.
  colorIndex?: number | null | undefined
  percent?: number | undefined
  examDate: string
  today: string
  restDays: number
  range: TimelineRange
  blocks: readonly Block[]
  error: ApiError | null
  onRetry: () => void
}) {
  const titleId = useId()
  const colour = examColor(colorIndex)
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
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-card">
      <div className="flex items-baseline justify-between gap-x-4">
        <h2 id={titleId} className="text-body font-semibold text-ink">
          {t.title}
        </h2>
        {percent === undefined ? null : (
          <span className="text-small text-ink-muted tabular-nums">{en.exams.exam.timeline.progress(percent)}</span>
        )}
      </div>
      {error === null ? null : <ErrorState message={errorMessage(error)} onRetry={onRetry} />}
      {days.length === 0 ? (
        <p className="text-body text-ink-muted">{t.noDays}</p>
      ) : (
        <div data-scroll-cue="" className="snap-x snap-mandatory overflow-x-auto overscroll-x-contain" style={SCROLL_CUE}>
          <ol aria-label={t.listLabel} className="flex">
            {days.map((info) => (
              <Day key={info.day} info={info} max={max} colour={colour} />
            ))}
          </ol>
        </div>
      )}
      {days.length === 0 ? null : <Legend colour={colour} />}
      {range.far ? <p className="text-small text-ink-muted">{t.farNote}</p> : null}
    </section>
  )
}
