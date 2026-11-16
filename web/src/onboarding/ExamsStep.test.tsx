import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import { he } from '../i18n/he'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { ToastRegion } from '../ui/toast'
import { ExamsStep } from './ExamsStep'
import { STEP_PATHS } from './steps'
import type { Exam, ExamCreate } from './types'

const t = he.onboardingExams

// An API with a list of exams that POST, DELETE and undo change, like the server does.
function examsApi(initial: Exam[] = []) {
  let exams = [...initial]
  const fake = createFakeApi()
  fake
    .on('GET /exams', () => exams)
    .on('POST /exams', (call: ApiCall) => {
      const body = call.body as ExamCreate
      const exam: Exam = { id: `e${String(exams.length + 1)}`, ...body, created_at: '2026-11-16T08:00:00Z' }
      exams = [...exams, exam]
      return { exam, plan_affected: false }
    })
    .on({ method: 'DELETE', path: /^\/exams\// }, (call: ApiCall) => {
      const id = call.path.split('/')[2]
      exams = exams.filter((e) => e.id !== id)
      return { version_id: `v-${String(id)}`, plan_affected: false }
    })
    .on('POST /plan/undo', () => {
      exams = [...initial]
      return { restored: 1, deleted: 0, replaced: [], unplaced: [] }
    })
  return fake
}

function renderExams(fake: FakeApi) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: STEP_PATHS.exams, element: <ExamsStep /> },
      { path: STEP_PATHS.materials, element: <p>materials</p> },
    ],
    { initialEntries: [STEP_PATHS.exams] },
  )
  render(
    <AppProviders
      auth={createFakeAuth(fakeSession()).client}
      api={fake.api}
      storage={createFakeStorage().client}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
      <ToastRegion />
    </AppProviders>,
  )
  return router
}

// A local date `days` from today, as 'YYYY-MM-DD' and as its parts.
function daysFromToday(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    iso: `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    day: pad(d.getDate()),
    month: pad(d.getMonth() + 1),
    year: String(d.getFullYear()),
    date: d,
  }
}

// Types a date into the DatePicker's segments (he-IL: day, month, year).
async function typeDate(user: UserEvent, value: { day: string; month: string; year: string }) {
  const group = screen.getByRole('group', { name: t.date })
  const [first] = within(group).getAllByRole('spinbutton')
  if (first === undefined) throw new Error('no date segments')
  await user.click(first)
  await user.keyboard(value.day + value.month + value.year)
}

async function fillExam(user: UserEvent, name: string, days = 30) {
  await user.type(screen.getByRole('textbox', { name: t.name }), name)
  const date = daysFromToday(days)
  await typeDate(user, date)
  return date
}

describe('ExamsStep', () => {
  it('shows the step, the title and the empty state', async () => {
    renderExams(examsApi())
    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeInTheDocument()
    expect(screen.getByText(he.onboarding.stepOf(1, 4))).toBeInTheDocument()
    expect(await screen.findByText(t.empty)).toBeInTheDocument()
  })

  it('adds an exam: POST /exams, clears the form, and lists it with its date and difficulty', async () => {
    const user = userEvent.setup()
    const fake = examsApi()
    renderExams(fake)
    await screen.findByText(t.empty)

    const date = await fillExam(user, 'אלגוריתמים')
    await user.click(screen.getByRole('radio', { name: t.difficultyLevels[3] }))
    await user.click(screen.getByRole('button', { name: t.add }))

    await waitFor(() => {
      expect(fake.calls('POST', '/exams')).toHaveLength(1)
    })
    expect(fake.calls('POST', '/exams').at(0)?.body).toEqual({ name: 'אלגוריתמים', exam_date: date.iso, difficulty: 4 })

    const list = await screen.findByRole('list', { name: t.listTitle })
    const item = within(list).getByRole('listitem')
    expect(item).toHaveTextContent('אלגוריתמים')
    const hebrewDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }).format(date.date)
    expect(item).toHaveTextContent(hebrewDate)
    expect(item).toHaveTextContent(t.difficultyOf(t.difficultyLevels[3]))

    expect(screen.getByRole('textbox', { name: t.name })).toHaveValue('')
    expect(screen.getByRole('radio', { name: t.difficultyLevels[2] })).toBeChecked()
  })

  it('defaults the difficulty to the middle', () => {
    renderExams(examsApi())
    expect(screen.getByRole('radio', { name: t.difficultyLevels[2] })).toBeChecked()
  })

  it('an empty name and a missing date show errors next to the fields, without calling the API', async () => {
    const user = userEvent.setup()
    const fake = examsApi()
    renderExams(fake)
    await screen.findByText(t.empty)

    await user.click(screen.getByRole('button', { name: t.add }))

    expect(await screen.findByText(t.nameRequired)).toBeInTheDocument()
    expect(screen.getByText(t.dateRequired)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: t.name })).toHaveAccessibleDescription(t.nameRequired)
    expect(fake.calls('POST')).toHaveLength(0)
  })

  it('a date that is not after today is an error, without calling the API', async () => {
    const user = userEvent.setup()
    const fake = examsApi()
    renderExams(fake)
    await screen.findByText(t.empty)

    await fillExam(user, 'הסתברות', 0)
    await user.click(screen.getByRole('button', { name: t.add }))

    expect(await screen.findByText(t.dateTooEarly)).toBeInTheDocument()
    expect(fake.calls('POST')).toHaveLength(0)
  })

  it('a 422 exam_in_past is shown in Hebrew as an alert', async () => {
    const user = userEvent.setup()
    const fake = examsApi().on('POST /exams', problem(422, 'exam_in_past'))
    renderExams(fake)
    await screen.findByText(t.empty)

    await fillExam(user, 'הסתברות')
    await user.click(screen.getByRole('button', { name: t.add }))

    expect(await screen.findByRole('alert')).toHaveTextContent(he.codes.exam_in_past)
    expect(screen.getByRole('textbox', { name: t.name })).toHaveValue('הסתברות')
  })

  it('delete hides the exam, shows a toast with undo, and undo sends the version_id', async () => {
    const user = userEvent.setup()
    const exam: Exam = { id: 'e1', name: 'שפת C', exam_date: daysFromToday(20).iso, difficulty: 3, created_at: '2026-11-16T08:00:00Z' }
    const fake = examsApi([exam])
    renderExams(fake)

    await user.click(await screen.findByRole('button', { name: t.deleteExam('שפת C') }))

    const region = await screen.findByRole('region', { name: he.common.notifications })
    await within(region).findByText(t.deleted('שפת C'))
    expect(fake.calls('DELETE', '/exams/e1')).toHaveLength(1)
    expect(await screen.findByText(t.empty)).toBeInTheDocument()

    await user.click(within(region).getByRole('button', { name: he.common.undo }))

    await waitFor(() => {
      expect(fake.calls('POST', '/plan/undo')).toHaveLength(1)
    })
    expect(fake.calls('POST', '/plan/undo').at(0)?.body).toEqual({ version_id: 'v-e1' })
    expect(await screen.findByRole('button', { name: t.deleteExam('שפת C') })).toBeInTheDocument()
  })

  it('"next" is disabled without an exam, and goes to the materials step with one', async () => {
    const user = userEvent.setup()
    renderExams(examsApi())
    await screen.findByText(t.empty)
    expect(screen.getByRole('button', { name: he.common.next })).toBeDisabled()

    await fillExam(user, 'אלגוריתמים')
    await user.click(screen.getByRole('button', { name: t.add }))
    await screen.findByRole('list', { name: t.listTitle })

    const next = screen.getByRole('button', { name: he.common.next })
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    await user.click(next)
    expect(await screen.findByText('materials')).toBeInTheDocument()
  })
})
