import { screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { examFixture } from '../onboarding/testFixtures'
import type { ExamCreate } from '../onboarding/types'
import { problem, type ApiCall } from '../test/fakeApi'
import { addDays, longDate } from './dates'
import { TODAY, examServer, openRoute } from './testFixtures'

const t = en.exam
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
  it('lists the exams by date, each a link to its screen with the days left', async () => {
    const fake = examServer({
      exams: [
        examFixture({ id: 'e2', name: 'פיזיקה', exam_date: addDays(TODAY, 20) }),
        examFixture({ id: 'e1', name: 'חדו"א', exam_date: addDays(TODAY, 7) }),
      ],
    })
    openRoute(fake, '/exams')
    expect(await screen.findByRole('heading', { level: 1, name: t.list.title })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: t.list.listTitle })
    const links = within(list).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/exams/e1', '/exams/e2'])
    // The link is the name alone, stretched over the row (ListRow); the date and the days left are in the row.
    expect(links[0]).toHaveTextContent('חדו"א')
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent(t.inDays(7))
    expect(rows[0]).toHaveTextContent(longDate(addDays(TODAY, 7)))
    expect(screen.getByText(t.list.count(2))).toBeInTheDocument()
  })

  it('the days left are a badge: brand within a week, neutral further away and for an exam that passed', async () => {
    const fake = examServer({
      exams: [
        examFixture({ id: 'e0', name: 'עבר', exam_date: addDays(TODAY, -2) }),
        examFixture({ id: 'e1', name: 'קרוב', exam_date: addDays(TODAY, 7) }),
        examFixture({ id: 'e2', name: 'רחוק', exam_date: addDays(TODAY, 8) }),
      ],
    })
    openRoute(fake, '/exams')
    const list = await screen.findByRole('list', { name: t.list.listTitle })
    expect(within(list).getByText(t.inDays(-2))).toHaveClass('bg-surface-muted', 'text-ink-muted')
    expect(within(list).getByText(t.inDays(7))).toHaveClass('bg-brand-soft', 'text-brand-strong')
    expect(within(list).getByText(t.inDays(8))).toHaveClass('bg-surface-muted', 'text-ink-muted')
  })

  // Review Focus 1: nothing in the row has a fixed width, the name can break, and the badge sits
  // in the trailing slot, which takes at most half of the row.
  it('a long exam name without spaces breaks inside the row and keeps the badge on screen', async () => {
    const name = 'א'.repeat(120)
    openRoute(examServer({ exams: [examFixture({ id: 'e1', name, exam_date: addDays(TODAY, 3) })] }), '/exams')
    const link = await screen.findByRole('link', { name })
    expect(link).toHaveClass('break-words')
    expect(link.parentElement).toHaveClass('min-w-0', 'flex-1')
    const badge = screen.getByText(t.inDays(3))
    expect(badge).toHaveClass('truncate', 'max-w-full')
    expect(badge.parentElement).toHaveClass('max-w-[50%]', 'min-w-0', 'shrink-0')
    const row = link.closest('li')
    expect(row).not.toBeNull()
    for (const el of [row, ...(row?.querySelectorAll('*') ?? [])]) {
      expect(el?.className ?? '').not.toMatch(/(^|\s)(w-\d|min-w-\[|w-\[|truncate$|whitespace-nowrap)/)
    }
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
    answer({ exam: { id: 'e9', name: 'אלגוריתמים', exam_date: date, difficulty: 3, created_at: '2026-11-16T08:00:00Z' }, plan_affected: false })
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/exams/e9')
    })
    expect(fake.calls('POST', '/exams')).toHaveLength(1)
  })

  it('shows the empty state without exams', async () => {
    openRoute(examServer({ exams: [] }), '/exams')
    expect(await screen.findByText(t.list.empty)).toBeInTheDocument()
  })

  it('adds an exam: POST /exams, then opens the new exam screen', async () => {
    const user = userEvent.setup()
    const fake = examServer({ exams: [] })
    fake.on('POST /exams', (call: ApiCall) => ({
      exam: { id: 'e9', ...(call.body as ExamCreate), created_at: '2026-11-16T08:00:00Z' },
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
