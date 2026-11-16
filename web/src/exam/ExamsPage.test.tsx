import { screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { examFixture } from '../onboarding/testFixtures'
import type { ExamCreate } from '../onboarding/types'
import { problem, type ApiCall } from '../test/fakeApi'
import { addDays, longDate } from './dates'
import { TODAY, examServer, openRoute } from './testFixtures'

const t = he.exam
const f = he.onboardingExams

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
    expect(links[0]).toHaveTextContent('חדו"א')
    expect(links[0]).toHaveTextContent(t.inDays(7))
    expect(links[0]).toHaveTextContent(longDate(addDays(TODAY, 7)))
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

    await user.click(screen.getByRole('button', { name: t.list.newExam }))
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
    await user.click(screen.getByRole('button', { name: t.list.newExam }))
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
    await user.click(screen.getByRole('button', { name: t.list.newExam }))
    await user.type(screen.getByRole('textbox', { name: f.name }), 'x')
    await typeDate(user, addDays(TODAY, 3))
    await user.click(screen.getByRole('button', { name: t.list.create }))
    expect(await screen.findByRole('alert')).toHaveTextContent(he.codes.exam_in_past)
  })
})
