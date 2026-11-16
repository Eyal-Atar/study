import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { examFixture } from '../onboarding/testFixtures'
import { addDays, dayMonth, longDate, weekdayShort } from './dates'
import { EXAM, TODAY, blockFixture, examServer, openRoute } from './testFixtures'

const t = he.exam
const f = he.onboardingExams

function dayName(day: string) {
  return t.timeline.day(weekdayShort(day), dayMonth(day))
}

describe('ExamPage', () => {
  it('an unknown exam shows a not-found message with a link back to the list', async () => {
    openRoute(examServer(), '/exams/nope')
    expect(await screen.findByText(t.notFound)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t.backToList })).toHaveAttribute('href', '/exams')
  })

  it('shows the exam name, date and days left', async () => {
    openRoute(examServer(), '/exams/e1')
    expect(await screen.findByRole('heading', { level: 1, name: EXAM.name })).toBeInTheDocument()
    expect(screen.getByText(longDate(EXAM.exam_date), { exact: false })).toBeInTheDocument()
    expect(screen.getAllByText(t.inDays(5)).length).toBeGreaterThan(0)
  })

  it('edits the header in place: PATCH with the changed fields, and plan_affected offers a replan', async () => {
    const user = userEvent.setup()
    const fake = examServer().on('PATCH /exams/e1', {
      exam: { ...EXAM, difficulty: 5 },
      plan_affected: true,
    })
    openRoute(fake, '/exams/e1')
    await user.click(await screen.findByRole('button', { name: t.header.editLabel }))
    expect(screen.getByRole('textbox', { name: f.name })).toHaveValue(EXAM.name)
    await user.click(screen.getByRole('radio', { name: f.difficultyLevels[4] }))
    await user.click(screen.getByRole('button', { name: he.common.save }))

    await waitFor(() => {
      expect(fake.calls('PATCH', '/exams/e1').map((c) => c.body)).toEqual([{ difficulty: 5 }])
    })
    expect(await screen.findByRole('dialog')).toHaveTextContent(t.header.replanReason)
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/replan')).toHaveLength(1)
    })
  })

  it('a header save without changes sends nothing and closes the form', async () => {
    const user = userEvent.setup()
    const fake = examServer()
    openRoute(fake, '/exams/e1')
    await user.click(await screen.findByRole('button', { name: t.header.editLabel }))
    await user.click(screen.getByRole('button', { name: he.common.save }))
    expect(await screen.findByRole('button', { name: t.header.editLabel })).toBeInTheDocument()
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('cancel leaves the header as it was', async () => {
    const user = userEvent.setup()
    const fake = examServer()
    openRoute(fake, '/exams/e1')
    await user.click(await screen.findByRole('button', { name: t.header.editLabel }))
    await user.clear(screen.getByRole('textbox', { name: f.name }))
    await user.click(screen.getByRole('button', { name: he.common.cancel }))
    expect(screen.getByRole('heading', { level: 1, name: EXAM.name })).toBeInTheDocument()
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('the timeline asks the plan from today to the day before the exam, and shows each day', async () => {
    const fake = examServer({
      blocks: [
        blockFixture(),
        // Another exam's block on the same day does not count.
        blockFixture({ id: 'b2', exam_id: 'e2', task_id: 't9' }),
        blockFixture({
          id: 'b3',
          study_date: TODAY,
          starts_at: `${TODAY}T08:00:00Z`,
          ends_at: `${TODAY}T08:45:00Z`,
          status: 'done',
        }),
      ],
    })
    openRoute(fake, '/exams/e1')
    const list = await screen.findByRole('list', { name: t.timeline.listLabel })
    await waitFor(() => {
      expect(fake.calls('GET', `/plan?from=${TODAY}&to=${addDays(TODAY, 4)}`)).toHaveLength(1)
    })

    // Today to the exam day: 6 days.
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    const tomorrow = await within(list).findByRole('listitem', {
      name: new RegExp(`^${dayName(addDays(TODAY, 1))}: ${t.timeline.planned(90)}`),
    })
    expect(tomorrow).toBeInTheDocument()
    expect(
      within(list).getByRole('listitem', {
        name: `${dayName(TODAY)}: ${t.timeline.planned(45)}, ${t.timeline.done(45)}, ${t.timeline.today}`,
      }),
    ).toBeInTheDocument()
    // rest_days_before_exam is 1 in the fixture: the day before the exam is a rest day.
    expect(
      within(list).getByRole('listitem', { name: new RegExp(`^${dayName(addDays(TODAY, 4))}: .*${t.timeline.restDay}`) }),
    ).toBeInTheDocument()
    expect(
      within(list).getByRole('listitem', { name: new RegExp(`^${dayName(EXAM.exam_date)}: .*${t.timeline.examDay}`) }),
    ).toBeInTheDocument()
    expect(screen.queryByText(t.timeline.farNote)).not.toBeInTheDocument()
  })

  it('an exam more than 62 days away shows 62 days and a note', async () => {
    const far = examFixture({ exam_date: addDays(TODAY, 90) })
    const fake = examServer({ exams: [far] })
    openRoute(fake, '/exams/e1')
    const list = await screen.findByRole('list', { name: t.timeline.listLabel })
    expect(within(list).getAllByRole('listitem')).toHaveLength(62)
    expect(screen.getByText(t.timeline.farNote)).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', `/plan?from=${TODAY}&to=${addDays(TODAY, 61)}`)).toHaveLength(1)
    })
  })
})
