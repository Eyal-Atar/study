import { screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { examFixture } from '../test/onboardingFixtures'
import type { ExamCreate } from '../onboarding/types'
import { problem, type ApiCall } from '../test/fakeApi'
import { addDays, longDate } from './dates'
import { TODAY, examServer, openRoute, taskFixture } from '../test/examFixtures'

const t = en.exam
const x = en.exams

const f = en.onboardingExams

async function typeDate(user: UserEvent, iso: string) {
  const [year, month, day] = iso.split('-')
  const group = screen.getByRole('group', { name: f.date })
  const [first] = within(group).getAllByRole('spinbutton')
  if (first === undefined) throw new Error('no date segments')
  await user.click(first)
  await user.keyboard(`${String(day)}${String(month)}${String(year)}`)
}

describe('ExamsPage', () => {
  it('lists the exams by date on one card, each row one link named by the exam', async () => {
    const fake = examServer({
      exams: [
        examFixture({
          id: 'e2',
          name: 'פיזיקה',
          exam_date: addDays(TODAY, 20),
          color_index: 2,
        }),
        examFixture({
          id: 'e1',
          name: 'חדו"א',
          exam_date: addDays(TODAY, 7),
          color_index: 1,
        }),
      ],
    })
    fake.on('GET /exams/e1/tasks', [
      taskFixture({
        id: 'a',
        exam_id: 'e1',
        status: 'done',
        estimated_minutes: 42,
      }),
      taskFixture({
        id: 'b',
        exam_id: 'e1',
        status: 'todo',
        estimated_minutes: 58,
      }),
    ])
    openRoute(fake, '/exams')
    expect(await screen.findByRole('heading', { level: 1, name: t.list.title })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: t.list.listTitle })
    const links = within(list).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/exams/e1', '/exams/e2'])
    expect(links[0]).toHaveAccessibleName('חדו"א')
    expect(screen.getByText('חדו"א').closest('[dir="auto"]')).not.toBeNull()
    const rows = within(list).getAllByRole('listitem')
    // The initial of the exam, its chip, the date and the progress.
    expect(rows[0]).toHaveTextContent('ח')
    expect(rows[0]).toHaveTextContent(x.list.chip(7))
    expect(rows[0]).toHaveTextContent(`${longDate(addDays(TODAY, 7))}. ${x.list.progress(42)}`)
    expect(rows[1]).toHaveTextContent(`${longDate(addDays(TODAY, 20))}. ${x.list.noTasks}`)
    expect(screen.getByText(t.list.count(2))).toBeInTheDocument()
    const bar = await within(rows[0] as HTMLElement).findByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuetext', x.list.progress(42))
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(within(rows[1] as HTMLElement).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    // One card holds every row.
    expect(list.closest('[class*="bg-surface"]')).not.toBeNull()
  })

  it('says the days left as today, tomorrow or in N days, and "Exam day passed" after the date', async () => {
    const fake = examServer({
      exams: [
        examFixture({ id: 'e0', name: 'עבר', exam_date: addDays(TODAY, -2) }),
        examFixture({ id: 'e1', name: 'היום', exam_date: TODAY }),
        examFixture({ id: 'e2', name: 'מחר', exam_date: addDays(TODAY, 1) }),
        examFixture({ id: 'e3', name: 'רחוק', exam_date: addDays(TODAY, 22) }),
      ],
    })
    openRoute(fake, '/exams')
    const list = await screen.findByRole('list', { name: t.list.listTitle })
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent(x.list.passed)
    expect(rows[0]).not.toHaveTextContent('-')
    expect(rows[1]).toHaveTextContent('Today')
    expect(rows[2]).toHaveTextContent('Tomorrow')
    expect(rows[3]).toHaveTextContent('in 22 days')
  })

  it('an exam in any state, with its tasks failing to load, still gets its row', async () => {
    const fake = examServer({
      exams: [examFixture({ id: 'e1', name: 'x', exam_date: addDays(TODAY, 3) })],
    })
    fake.on('GET /exams/e1/tasks', problem(500, 'internal'))
    openRoute(fake, '/exams')
    const list = await screen.findByRole('list', { name: t.list.listTitle })
    expect(within(list).getByRole('link', { name: 'x' })).toBeInTheDocument()
    expect(within(list).getByText(longDate(addDays(TODAY, 3)))).toBeInTheDocument()
  })

  // Nothing in the row has a fixed width and the name can break.
  it('a long exam name without spaces breaks inside the row', async () => {
    const name = 'א'.repeat(120)
    openRoute(
      examServer({
        exams: [examFixture({ id: 'e1', name, exam_date: addDays(TODAY, 3) })],
      }),
      '/exams',
    )
    const link = await screen.findByRole('link', { name })
    expect(link).toHaveClass('break-words')
    expect(link.parentElement).toHaveClass('min-w-0', 'flex-1')
  })

  it('with exams the one primary action is "new exam" in the header; it gives way to the form', async () => {
    const user = userEvent.setup()
    openRoute(examServer(), '/exams')
    await screen.findByRole('list', { name: t.list.listTitle })
    await user.click(screen.getByRole('button', { name: t.list.newExam }))
    expect(screen.getByRole('heading', { level: 2, name: t.list.formTitle })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.list.newExam })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: en.common.cancel }))
    expect(screen.getByRole('button', { name: t.list.newExam })).toBeInTheDocument()
  })

  it('without exams the action lives in the empty state only, and hides while the form is open', async () => {
    const user = userEvent.setup()
    openRoute(examServer({ exams: [] }), '/exams')
    await screen.findByText(t.list.empty)
    expect(screen.queryByRole('button', { name: t.list.newExam })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: t.list.create })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: t.list.create }))
    // The form's own submit is now the only one with this name.
    expect(screen.getAllByRole('button', { name: t.list.create })).toHaveLength(1)
    expect(screen.getByRole('button', { name: t.list.create })).toHaveAttribute('type', 'submit')
    expect(screen.getByText(t.list.empty)).toBeInTheDocument()
  })

  // Review Focus 4: the submit button is pending, not disabled, and a second press sends nothing.
  it('a double press on the create button sends one POST', async () => {
    const user = userEvent.setup()
    let answer: (value: unknown) => void = () => undefined
    const fake = examServer({ exams: [] }).on(
      'POST /exams',
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const { router } = openRoute(fake, '/exams')
    await screen.findByText(t.list.empty)
    await user.click(screen.getByRole('button', { name: t.list.create }))
    await user.type(screen.getByRole('textbox', { name: f.name }), 'אלגוריתמים')
    const date = addDays(TODAY, 30)
    await typeDate(user, date)
    const submit = screen.getByRole('button', { name: t.list.create })
    await user.dblClick(submit)
    await user.click(submit)
    // The text stays while the request is out.
    expect(submit).toHaveTextContent(t.list.create)
    expect(fake.calls('POST', '/exams')).toHaveLength(1)
    answer({
      exam: {
        id: 'e9',
        name: 'אלגוריתמים',
        exam_date: date,
        difficulty: 3,
        created_at: '2026-11-16T08:00:00Z',
      },
      plan_affected: false,
    })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/exams/e9')
    })
    expect(fake.calls('POST', '/exams')).toHaveLength(1)
  })

  it('the empty screen names the tab "Exams" and its one h1 can take the route focus', async () => {
    openRoute(examServer({ exams: [] }), '/exams')
    const h1 = await screen.findByRole('heading', { level: 1, name: t.list.empty })
    expect(h1).toHaveAttribute('tabindex', '-1')
    expect(h1).toHaveClass('outline-none')
    expect(document.title).toBe(`${t.list.title} – ${en.appName}`)
  })

  it('a progress bar appears only when the tasks of its exam have arrived', async () => {
    const fake = examServer({ exams: [examFixture({ id: 'e1', name: 'x', exam_date: addDays(TODAY, 3) })] })
    let answer: (value: unknown) => void = () => undefined
    fake.on(
      'GET /exams/e1/tasks',
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    openRoute(fake, '/exams')
    const list = await screen.findByRole('list', { name: t.list.listTitle })
    expect(within(list).queryByRole('progressbar')).not.toBeInTheDocument()
    answer([taskFixture({ exam_id: 'e1', status: 'done', estimated_minutes: 30 })])
    expect(await within(list).findByRole('progressbar')).toHaveAttribute('aria-valuetext', x.list.progress(100))
  })

  it('shows Archi with the one heading, the hint and the button without exams', async () => {
    const { container } = openRoute(examServer({ exams: [] }), '/exams')
    expect(await screen.findByRole('heading', { level: 1, name: t.list.empty })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText(t.list.emptyHint)).toBeInTheDocument()
    expect(container.querySelector('[data-mood="intentions"]')).not.toBeNull()
  })

  it('adds an exam: POST /exams, then opens the new exam screen', async () => {
    const user = userEvent.setup()
    const fake = examServer({ exams: [] })
    fake.on('POST /exams', (call: ApiCall) => ({
      exam: {
        id: 'e9',
        ...(call.body as ExamCreate),
        created_at: '2026-11-16T08:00:00Z',
      },
      plan_affected: false,
    }))
    const { router } = openRoute(fake, '/exams')
    await screen.findByText(t.list.empty)

    await user.click(screen.getByRole('button', { name: t.list.create }))
    await user.type(screen.getByRole('textbox', { name: f.name }), 'אלגוריתמים')
    const date = addDays(TODAY, 30)
    await typeDate(user, date)
    await user.click(screen.getByRole('radio', { name: f.difficultyLevels[3] }))
    await user.click(screen.getByRole('button', { name: t.list.create }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/exams/e9')
    })
    expect(fake.calls('POST', '/exams').map((c) => c.body)).toEqual([{ name: 'אלגוריתמים', exam_date: date, difficulty: 4 }])
  })

  it('a missing name and date show errors and send nothing', async () => {
    const user = userEvent.setup()
    const fake = examServer({ exams: [] })
    openRoute(fake, '/exams')
    await screen.findByText(t.list.empty)
    await user.click(screen.getByRole('button', { name: t.list.create }))
    await user.click(screen.getByRole('button', { name: t.list.create }))
    expect(await screen.findByText(f.nameRequired)).toBeInTheDocument()
    expect(screen.getByText(f.dateRequired)).toBeInTheDocument()
    expect(fake.calls('POST', '/exams')).toHaveLength(0)
  })

  it('a server error on create is shown next to the form', async () => {
    const user = userEvent.setup()
    const fake = examServer({ exams: [] }).on('POST /exams', problem(422, 'exam_in_past'))
    openRoute(fake, '/exams')
    await screen.findByText(t.list.empty)
    await user.click(screen.getByRole('button', { name: t.list.create }))
    await user.type(screen.getByRole('textbox', { name: f.name }), 'x')
    await typeDate(user, addDays(TODAY, 3))
    await user.click(screen.getByRole('button', { name: t.list.create }))
    expect(await screen.findByRole('alert')).toHaveTextContent(en.codes.exam_in_past)
  })
})
