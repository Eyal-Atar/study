import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { en } from '../i18n/en'
import { examColor } from '../ui/examColor'
import { addDays, dayMonth, weekdayShort } from './dates'
import { blockFixture, TODAY } from '../test/examFixtures'
import { Timeline } from './Timeline'
import { timelineRange } from './timelineDays'

const t = en.exam.timeline
const COLOR = examColor(1)
const EXAM_DATE = addDays(TODAY, 5)

function dayName(day: string) {
  return t.day(weekdayShort(day), dayMonth(day))
}

function show(overrides: Partial<Parameters<typeof Timeline>[0]> = {}) {
  const onRetry = vi.fn()
  render(
    <Timeline
      examId="e1"
      colorIndex={1}
      percent={42}
      examDate={EXAM_DATE}
      today={TODAY}
      restDays={1}
      range={timelineRange(TODAY, EXAM_DATE)}
      blocks={[
        // Tomorrow: 90 planned minutes, nothing done.
        blockFixture(),
        // Today: 45 of 90 minutes done.
        blockFixture({ id: 'b2', study_date: TODAY, starts_at: `${TODAY}T08:00:00Z`, ends_at: `${TODAY}T08:45:00Z`, status: 'done' }),
        blockFixture({ id: 'b3', study_date: TODAY, starts_at: `${TODAY}T10:00:00Z`, ends_at: `${TODAY}T10:45:00Z` }),
      ]}
      error={null}
      onRetry={onRetry}
      {...overrides}
    />,
  )
  return { onRetry }
}

function dayItem(day: string) {
  const list = screen.getByRole('list', { name: t.listLabel })
  return within(list).getByRole('listitem', { name: new RegExp(`^${dayName(day)}: `) })
}

describe('Timeline', () => {
  it('each day is a list item with its full label', () => {
    show()
    const list = screen.getByRole('list', { name: t.listLabel })
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual([
      `${dayName(TODAY)}: ${t.planned(90)}, ${t.done(45)}, ${t.today}`,
      `${dayName(addDays(TODAY, 1))}: ${t.planned(90)}`,
      `${dayName(addDays(TODAY, 2))}: ${t.planned(0)}`,
      `${dayName(addDays(TODAY, 3))}: ${t.planned(0)}`,
      `${dayName(addDays(TODAY, 4))}: ${t.planned(0)}, ${t.restDay}`,
      `${dayName(EXAM_DATE)}: ${t.planned(0)}, ${t.examDay}`,
    ])
    expect(screen.getByRole('heading', { level: 2, name: t.title })).toBeInTheDocument()
  })

  it('a planned day is a bar in the soft colour of the exam with its line, and the done part fills it in green from the bottom', () => {
    show()
    const today = dayItem(TODAY)
    const planned = today.querySelector('[data-mark="planned"]')
    expect(planned).toHaveClass('border', COLOR.soft, COLOR.line, 'justify-end')
    const done = planned?.querySelector('[data-mark="done"]')
    expect(done).toHaveClass('bg-success')
    // 45 of 90 minutes: half of the bar.
    expect(done).toHaveStyle({ height: '36px' })
    expect(planned).toHaveStyle({ height: '72px' })

    const tomorrow = dayItem(addDays(TODAY, 1))
    expect(tomorrow.querySelector('[data-mark="planned"]')).not.toBeNull()
    expect(tomorrow.querySelector('[data-mark="done"]')).toBeNull()
    // A day with nothing planned is a short tick, not a bar.
    expect(dayItem(addDays(TODAY, 2)).querySelector('[data-mark="none"]')).toHaveClass('bg-line')
    // The width of a column.
    // Seven whole columns fill the box at rest (a share of its width, never shrunk), and each is a snap point.
    expect(today).toHaveClass('basis-1/7', 'shrink-0', 'snap-start')
  })

  it('today says "Today" in words; the exam day and the rest day are icons with no text that can wrap', () => {
    show()
    expect(within(dayItem(TODAY)).getByText(t.today)).toHaveClass('font-semibold', 'text-brand-strong')

    const exam = dayItem(EXAM_DATE)
    expect(exam.querySelector('svg[data-mark="exam"]')).toHaveClass(COLOR.text)
    expect(exam).not.toHaveTextContent(t.examDay)
    // Only the two short labels, each on one line.
    expect(exam.textContent).toBe(`${weekdayShort(EXAM_DATE)}${dayMonth(EXAM_DATE)}`)
    for (const label of exam.querySelectorAll('span.text-caption')) expect(label).toHaveClass('whitespace-nowrap')
    expect(exam.className).not.toMatch(/bg-brand/)

    const rest = dayItem(addDays(TODAY, 4))
    expect(rest.querySelector('[data-mark="rest"]')).toHaveClass('text-ink-muted')
    expect(rest).not.toHaveTextContent(t.restDay)
  })

  it('the legend lists the four signs with their words, hidden from screen readers', () => {
    const { container } = render(
      <Timeline examId="e1" colorIndex={1} examDate={EXAM_DATE} today={TODAY} restDays={0} range={timelineRange(TODAY, EXAM_DATE)} blocks={[]} error={null} onRetry={vi.fn()} />,
    )
    const legend = container.querySelector('[data-legend]')
    expect(legend).toHaveAttribute('aria-hidden', 'true')
    expect(Array.from(legend?.children ?? []).map((item) => item.textContent)).toEqual([
      t.legendPlanned,
      t.legendDone,
      t.legendRest,
      t.legendExam,
    ])
    // Each word has its sign beside it: two swatches and two icons.
    expect(legend?.querySelectorAll('svg')).toHaveLength(2)
    expect(legend?.querySelector(`.${COLOR.line}`)).not.toBeNull()
    expect(legend?.querySelector('.bg-success')).not.toBeNull()
  })

  it('the chart scrolls inside its own box, never the page', () => {
    show()
    const box = screen.getByRole('list', { name: t.listLabel }).parentElement
    expect(box).toHaveClass('overflow-x-auto', 'snap-x', 'snap-mandatory')
    // A soft edge on the side that has more days is the cue that the row scrolls.
    expect(box).toHaveAttribute('data-scroll-cue')
    // The card around it is the surface, so only the chart scrolls.
    expect(screen.getByRole('region', { name: t.title })).toHaveClass('rounded-card', 'border', 'border-line', 'bg-surface')
  })

  it('the card says how much of the plan is done, beside its heading', () => {
    show()
    expect(screen.getByText(en.exams.exam.timeline.progress(42))).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: t.title })).getByRole('heading', { level: 2, name: t.title })).toBeInTheDocument()
  })

  it('in LTR today is the first day in the row, so the box opens on it at the left', () => {
    show()
    const list = screen.getByRole('list', { name: t.listLabel })
    const box = list.parentElement
    // No reversed row and no direction of its own: the scroll starts at the left, on day one.
    expect(list.className).not.toMatch(/reverse/)
    expect(list).not.toHaveAttribute('dir')
    expect(box).not.toHaveAttribute('dir')
    expect(within(list).getAllByRole('listitem')[0]).toBe(dayItem(TODAY))
  })

  it('a failed plan shows the error with a retry above the chart, and the days stay', () => {
    const { onRetry } = show({ blocks: [], error: new ApiError(500, 'internal', null, {}) })
    const alert = screen.getByRole('alert')
    const list = screen.getByRole('list', { name: t.listLabel })
    expect(alert.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    within(alert).getByRole('button', { name: en.common.retry }).click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('an exam that passed has no days: a quiet sentence, no chart and no legend', () => {
    const { container } = render(
      <Timeline examId="e1" examDate={addDays(TODAY, -1)} today={TODAY} restDays={1} range={timelineRange(TODAY, addDays(TODAY, -1))} blocks={[]} error={null} onRetry={vi.fn()} />,
    )
    expect(screen.getByText(t.noDays)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(container.querySelector('[data-legend]')).toBeNull()
  })
})
