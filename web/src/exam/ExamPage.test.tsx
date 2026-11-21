import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { COMPLETED_AT, examFixture, meFixture } from '../onboarding/testFixtures'
import { addDays, dayMonth, longDate, weekdayShort } from './dates'
import { problem } from '../test/fakeApi'
import { EXAM, TODAY, blockFixture, examServer, openRoute } from '../test/examFixtures'

const t = en.exam
const f = en.onboardingExams

function dayName(day: string) {
  return t.timeline.day(weekdayShort(day), dayMonth(day))
}

afterEach(() => {
  vi.useRealTimers()
})

// The study day (S09): before the wake time it is still the day before, and GET /plan filters by it.
describe('ExamPage study day', () => {
  function atJerusalem(utc: string) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(utc))
    const fake = examServer({ exams: [examFixture({ exam_date: '2026-11-26' })] }).on(
      'GET /me',
      meFixture({ onboarding_completed_at: COMPLETED_AT, timezone: 'Asia/Jerusalem', wake_time: '08:00' }),
    )
    openRoute(fake, '/exams/e1')
    return fake
  }

  it('at 01:00 with wake 08:00 the timeline asks GET /plan from yesterday', async () => {
    // 23:00Z on 20.11 is 01:00 on 21.11 in Jerusalem.
    const fake = atJerusalem('2026-11-20T23:00:00Z')
    await waitFor(() => {
      expect(fake.calls('GET', '/plan?from=2026-11-20&to=2026-11-25')).toHaveLength(1)
    })
    const list = await screen.findByRole('list', { name: t.timeline.listLabel })
    expect(within(list).getAllByRole('listitem')).toHaveLength(7)
  })

  it('at 09:00 the timeline asks GET /plan from today', async () => {
    const fake = atJerusalem('2026-11-21T07:00:00Z')
    await waitFor(() => {
      expect(fake.calls('GET', '/plan?from=2026-11-21&to=2026-11-25')).toHaveLength(1)
    })
    expect(fake.calls('GET').some((c) => c.path.startsWith('/plan?from=2026-11-20'))).toBe(false)
  })

  it('at 01:00 the days left and the edit form still count calendar days (the API checks exam_date > calendar today)', async () => {
    atJerusalem('2026-11-20T23:00:00Z')
    // 21.11 to 26.11: 5 calendar days, not 6.
    // The h1 is on screen from the first render (the generic title while loading), so wait for the header itself.
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect((await screen.findAllByText(t.inDays(5))).length).toBeGreaterThan(0)
  })
})

describe('ExamPage', () => {
  it('an unknown exam shows a not-found message with a link back to the list', async () => {
    openRoute(examServer(), '/exams/nope')
    expect(await screen.findByText(t.notFound)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t.backToList })).toHaveAttribute('href', '/exams')
    // LTR: "back" points left.
    expect(screen.getByRole('link', { name: t.backToList }).querySelector('svg')).toHaveClass('lucide-chevron-left')
  })

  it('the h1 is there at once: the generic title while the exams load, then the name of the exam', async () => {
    let answer: (value: unknown) => void = () => undefined
    const fake = examServer().on(
      'GET /exams',
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    openRoute(fake, '/exams/e1')
    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t.backToList })).toHaveAttribute('href', '/exams')
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
    answer([EXAM])
    const heading = await screen.findByRole('heading', { level: 1, name: EXAM.name })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // The exam name is user content: a Hebrew name in the h1 takes its own direction.
    expect(within(heading).getByText(EXAM.name).closest('[dir="auto"]')).not.toBeNull()
  })

  it('a failed load keeps the h1 and offers to try again', async () => {
    const user = userEvent.setup()
    const fake = examServer().on('GET /exams', problem(500, 'internal'))
    openRoute(fake, '/exams/e1')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeInTheDocument()
    const before = fake.calls('GET', '/exams').length
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    await waitFor(() => {
      expect(fake.calls('GET', '/exams').length).toBeGreaterThan(before)
    })
  })

  it('the header is one quiet line (date, days left, difficulty), and the edit button shows the edit label', async () => {
    openRoute(examServer(), '/exams/e1')
    const heading = await screen.findByRole('heading', { level: 1, name: EXAM.name })
    const line = heading.nextElementSibling
    expect(line).toHaveTextContent(
      `${longDate(EXAM.exam_date)}, ${t.inDays(5)}. ${f.difficultyOf(f.difficultyLevels[EXAM.difficulty - 1] ?? '')}`,
    )
    expect(screen.getByRole('button', { name: t.header.editNamed })).toHaveTextContent(t.header.edit)
  })

  it('while editing the h1 stays, the edit button goes, and the form opens under the title', async () => {
    const user = userEvent.setup()
    openRoute(examServer(), '/exams/e1')
    await user.click(await screen.findByRole('button', { name: t.header.editNamed }))
    expect(screen.getByRole('heading', { level: 1, name: EXAM.name })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.header.editNamed })).not.toBeInTheDocument()
    expect(screen.getByRole('form', { name: t.header.editLabel })).toBeInTheDocument()
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
    await user.click(await screen.findByRole('button', { name: t.header.editNamed }))
    expect(screen.getByRole('textbox', { name: f.name })).toHaveValue(EXAM.name)
    await user.click(screen.getByRole('radio', { name: f.difficultyLevels[4] }))
    await user.click(screen.getByRole('button', { name: en.common.save }))

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
    await user.click(await screen.findByRole('button', { name: t.header.editNamed }))
    await user.click(screen.getByRole('button', { name: en.common.save }))
    expect(await screen.findByRole('button', { name: t.header.editNamed })).toBeInTheDocument()
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('cancel leaves the header as it was', async () => {
    const user = userEvent.setup()
    const fake = examServer()
    openRoute(fake, '/exams/e1')
    await user.click(await screen.findByRole('button', { name: t.header.editNamed }))
    await user.clear(screen.getByRole('textbox', { name: f.name }))
    await user.click(screen.getByRole('button', { name: en.common.cancel }))
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
