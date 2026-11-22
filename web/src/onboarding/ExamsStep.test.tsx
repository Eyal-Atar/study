import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Me } from '../api/me'
import { AppProviders } from '../app/AppProviders'
import type { Commitment } from '../availability/types'
import { addDays, todayIn } from '../exam/dates'
import { en } from '../i18n/en'
import { LOCALE } from '../i18n/locale'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { BROWSER_ZONE, meFixture } from '../test/onboardingFixtures'
import { examColor } from '../ui/examColor'
import { ToastRegion } from '../ui/toast'
import { ExamsStep } from './ExamsStep'
import { clearMarkedCells, setMarkedCells } from './markedHours'
import { STEP_PATHS } from './steps'
import type { Exam, ExamCreate } from './types'

const t = en.onboardingExams
const f = en.onboardingFlow.feasibility

// An API with a list of exams that POST, DELETE and undo change, like the server does, and the
// profile the live estimate reads (4 hours a day, mornings and afternoons, 1 rest day).
function examsApi(initial: Exam[] = [], me: Partial<Me> = {}) {
  let exams = [...initial]
  const fake = createFakeApi()
  fake
    .on('GET /me', meFixture(me))
    .on('GET /exams', () => exams)
    .on('GET /commitments', { commitments: [] })
    .on('POST /exams', (call: ApiCall) => {
      const body = call.body as ExamCreate
      const exam: Exam = { id: `e${String(exams.length + 1)}`, ...body, created_at: '2026-11-16T08:00:00Z', color_index: 0 }
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

// Types a date into the DatePicker's segments (en-IL: day, month, year).
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

// The exams were read: the place of the list is no longer busy. The step has no empty state: with
// no exam there is only Archi's question and the form.
async function loaded() {
  const place = document.querySelector('[data-part="exams"]')
  if (place === null) throw new Error('no place for the exams')
  await waitFor(() => {
    expect(place).toHaveAttribute('aria-busy', 'false')
  })
}

const noExamRows = () => screen.queryByRole('list', { name: t.listTitle })

// Hours marked in step 4 by an earlier test would count in this one's estimate.
beforeEach(() => {
  clearMarkedCells()
})

// An exam in three days with one rest day, in the profile's own zone: tomorrow is the only study
// day, and its study hours are 09:00–17:00 (the morning and the afternoon, an hour after waking).
const zoneToday = todayIn(BROWSER_ZONE)
const soonExam: Exam = { id: 'e1', name: 'שפת C', exam_date: addDays(zoneToday, 3), difficulty: 3, created_at: '2026-11-16T08:00:00Z', color_index: 0 }
const tomorrowWeekday = new Date(`${addDays(zoneToday, 1)}T00:00:00Z`).getUTCDay() as Commitment['weekday']
const busyTomorrow: Commitment = {
  id: 'c1',
  title: 'משמרת עבודה',
  kind: 'work',
  weekday: tomorrowWeekday,
  start_time: '09:00',
  end_time: '17:00',
  valid_from: '2026-11-01',
  valid_until: null,
  source_job_id: null,
  created_at: '2026-11-01T08:00:00Z',
}

describe('ExamsStep', () => {
  it('a saved busy time lowers the hours in the estimate', async () => {
    renderExams(examsApi([soonExam]).on('GET /commitments', { commitments: [busyTomorrow] }))
    expect(await screen.findByText(f.none('שפת C'))).toBeInTheDocument()
  })

  it('the hours marked in step 4 and not saved yet count in the estimate', async () => {
    const cells = new Set<string>()
    for (let hour = 9; hour < 17; hour += 1) cells.add(`${String(tomorrowWeekday)}-${String(hour)}`)
    setMarkedCells(cells)
    renderExams(examsApi([soonExam]))
    expect(await screen.findByText(f.none('שפת C'))).toBeInTheDocument()
  })

  it('without busy time the same exam has study time', async () => {
    renderExams(examsApi([soonExam]))
    const status = await screen.findByText(/study hours/)
    expect(status).not.toHaveTextContent(f.none('שפת C'))
  })

  it('shows the step and Archi’s question, and with no exam only the form under it', async () => {
    renderExams(examsApi())
    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeInTheDocument()
    expect(screen.getByText(en.onboarding.stepOf(1, 4))).toBeInTheDocument()
    expect(screen.getByText(t.intro)).toBeInTheDocument()
    await loaded()
    expect(noExamRows()).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: t.name })).toBeInTheDocument()
  })

  it('Archi leads the real screen: he stands before his question, which is its only h1', async () => {
    const exam: Exam = { id: 'e1', name: 'שפת C', exam_date: daysFromToday(20).iso, difficulty: 3, created_at: '2026-11-16T08:00:00Z', color_index: 0 }
    renderExams(examsApi([exam]))
    await screen.findByRole('list', { name: t.listTitle })

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    const [heading] = headings
    if (heading === undefined) throw new Error('no heading')
    expect(heading).toHaveTextContent(t.title)
    const archi = screen.getByRole('img', { name: en.archie.alt.joy })
    expect(archi.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Everything that answers him comes after the question, on one card.
    const name = screen.getByRole('textbox', { name: t.name })
    expect(heading.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const card = name.closest('.rounded-card')
    expect(card).not.toBeNull()
    expect(card).toContainElement(screen.getByRole('list', { name: t.listTitle }))
    expect(card).toContainElement(screen.getByText(t.intro))
  })

  it('the first step has no "Back", at the top or at the bottom', async () => {
    renderExams(examsApi())
    await loaded()
    expect(screen.queryByRole('button', { name: en.common.back })).not.toBeInTheDocument()
    const bar = screen.getByRole('button', { name: en.onboarding.continue }).parentElement
    if (bar === null) throw new Error('no actions bar')
    expect(within(bar).getAllByRole('button')).toHaveLength(1)
  })

  it('Archi answers each exam at once: the estimate appears with the first exam, changes with the next, and goes with the last', async () => {
    const user = userEvent.setup()
    // 4 hours a day and 1 rest day: an exam in 60 days leaves 58 study days, 232 hours.
    renderExams(examsApi())
    await loaded()
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    const far = await fillExam(user, 'אלגוריתמים', 60)
    await user.click(screen.getByRole('button', { name: t.add }))
    await waitFor(() => {
      expect(status).toHaveTextContent(f.roomy(58 * 240, 'אלגוריתמים'))
    })
    expect(far.iso > daysFromToday(1).iso).toBe(true)
    // The estimate is under the list, and before the form that adds the next exam.
    const list = screen.getByRole('list', { name: t.listTitle })
    expect(list.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(status.compareDocumentPosition(screen.getByRole('textbox', { name: t.name })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // An exam the day after tomorrow, with a rest day before it: no study day is left for it.
    await fillExam(user, 'הסתברות', 2)
    await user.click(screen.getByRole('button', { name: t.add }))
    await waitFor(() => {
      expect(status).toHaveTextContent(f.none('הסתברות'))
    })

    await user.click(screen.getByRole('button', { name: t.deleteExam('הסתברות') }))
    await waitFor(() => {
      expect(status).toHaveTextContent(f.roomy(58 * 240, 'אלגוריתמים'))
    })
    await user.click(screen.getByRole('button', { name: t.deleteExam('אלגוריתמים') }))
    await waitFor(() => {
      expect(status).toBeEmptyDOMElement()
    })
  })

  it('the estimate reads the profile: fewer hours a day make the same exam tight', async () => {
    const exam: Exam = { id: 'e1', name: 'שפת C', exam_date: daysFromToday(20).iso, difficulty: 3, created_at: '2026-11-16T08:00:00Z', color_index: 0 }
    // 18 study days of 30 minutes: 9 hours, under the 10 of a tight exam.
    renderExams(examsApi([exam], { daily_study_minutes: 30 }))
    expect(await screen.findByText(f.tight(18 * 30, 'שפת C'))).toBeInTheDocument()
  })

  it('each exam row has its initial in its colour, and a delete button named after it', async () => {
    const exam: Exam = { id: 'e1', name: 'שפת C', exam_date: daysFromToday(20).iso, difficulty: 4, created_at: '2026-11-16T08:00:00Z', color_index: 2 }
    renderExams(examsApi([exam]))
    const item = within(await screen.findByRole('list', { name: t.listTitle })).getByRole('listitem')
    const initial = within(item).getByText('ש')
    expect(initial).toHaveAttribute('aria-hidden', 'true')
    const colour = examColor(2)
    expect(initial).toHaveClass(colour.soft, colour.text)
    expect(t.deleteExam('שפת C')).toMatch(/^Delete: /)
    expect(within(item).getByRole('button', { name: t.deleteExam('שפת C') })).toBeInTheDocument()
  })

  it('adds an exam: POST /exams, clears the form, and lists it with its date and difficulty', async () => {
    const user = userEvent.setup()
    const fake = examsApi()
    renderExams(fake)
    await loaded()

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
    // A name in any language decides its own direction.
    expect(within(item).getByText('אלגוריתמים').closest('[dir="auto"]')).not.toBeNull()
    // "20 January 2027": day, long month, year (en-IL).
    const longDate = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }).format(date.date)
    expect(longDate).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/)
    // One subtitle, with a comma-and-period separator and not a middle dot.
    expect(within(item).getByText(t.details(longDate, t.difficultyLevels[3]))).toBeInTheDocument()

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
    await loaded()

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
    await loaded()

    await fillExam(user, 'הסתברות', 0)
    await user.click(screen.getByRole('button', { name: t.add }))

    expect(await screen.findByText(t.dateTooEarly)).toBeInTheDocument()
    expect(fake.calls('POST')).toHaveLength(0)
  })

  it('a 422 exam_in_past is shown in Hebrew as an alert', async () => {
    const user = userEvent.setup()
    const fake = examsApi().on('POST /exams', problem(422, 'exam_in_past'))
    renderExams(fake)
    await loaded()

    await fillExam(user, 'הסתברות')
    await user.click(screen.getByRole('button', { name: t.add }))

    expect(await screen.findByRole('alert')).toHaveTextContent(en.codes.exam_in_past)
    expect(screen.getByRole('textbox', { name: t.name })).toHaveValue('הסתברות')
  })

  it('delete hides the exam, shows a toast with undo, and undo sends the version_id', async () => {
    const user = userEvent.setup()
    const exam: Exam = { id: 'e1', name: 'שפת C', exam_date: daysFromToday(20).iso, difficulty: 3, created_at: '2026-11-16T08:00:00Z', color_index: 0 }
    const fake = examsApi([exam])
    renderExams(fake)

    await user.click(await screen.findByRole('button', { name: t.deleteExam('שפת C') }))

    const region = await screen.findByRole('region', { name: en.common.notifications })
    await within(region).findByText(t.deleted('שפת C'))
    expect(fake.calls('DELETE', '/exams/e1')).toHaveLength(1)
    await waitFor(() => {
      expect(noExamRows()).not.toBeInTheDocument()
    })

    await user.click(within(region).getByRole('button', { name: en.common.undo }))

    await waitFor(() => {
      expect(fake.calls('POST', '/plan/undo')).toHaveLength(1)
    })
    expect(fake.calls('POST', '/plan/undo').at(0)?.body).toEqual({ version_id: 'v-e1' })
    expect(await screen.findByRole('button', { name: t.deleteExam('שפת C') })).toBeInTheDocument()
  })

  it('a double press on "Add exam" sends one POST, and the button keeps its text while it is sent', async () => {
    const user = userEvent.setup()
    const fake = examsApi()
    let answer: () => void = () => undefined
    fake.on(
      'POST /exams',
      (call: ApiCall) =>
        new Promise((resolve) => {
          const body = call.body as ExamCreate
          answer = () => {
            resolve({ exam: { id: 'e1', ...body, created_at: '2026-11-16T08:00:00Z', color_index: 0 }, plan_affected: false })
          }
        }),
    )
    renderExams(fake)
    await loaded()

    await fillExam(user, 'אלגוריתמים')
    const add = screen.getByRole('button', { name: t.add })
    await user.dblClick(add)
    await user.click(add)

    await waitFor(() => {
      expect(fake.calls('POST', '/exams')).toHaveLength(1)
    })
    expect(screen.getByRole('button', { name: new RegExp(t.add) })).toHaveTextContent(t.add)
    answer()
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: t.name })).toHaveValue('')
    })
    expect(fake.calls('POST', '/exams')).toHaveLength(1)
  })

  it('a long exam name without spaces wraps inside its row and does not widen the page', async () => {
    const name = 'א'.repeat(120)
    const exam: Exam = { id: 'e1', name, exam_date: daysFromToday(20).iso, difficulty: 3, created_at: '2026-11-16T08:00:00Z', color_index: 0 }
    renderExams(examsApi([exam]))

    const title = await screen.findByText(name)
    expect(title.closest('.break-words')).not.toBeNull()
    // The column of the name may shrink, and the delete button keeps its 44px beside it.
    expect(title.closest('.min-w-0')).not.toBeNull()
    expect(title.closest('.truncate')).toBeNull()
    const row = title.closest('li')
    if (row === null) throw new Error('no row')
    expect(within(row).getByRole('button', { name: t.deleteExam(name) })).toHaveClass('size-touch', 'shrink-0')
  })

  it('a failed load of the exams shows the error with a retry, under the title', async () => {
    const user = userEvent.setup()
    const fake = createFakeApi().on('GET /me', meFixture()).on('GET /exams', problem(503, 'database_unavailable'))
    renderExams(fake)
    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(en.codes.database_unavailable)
    fake.on('GET /exams', [])
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
    await loaded()
  })

  it('"Continue" is disabled without an exam, and goes to the materials step with one', async () => {
    const user = userEvent.setup()
    renderExams(examsApi())
    await loaded()
    const proceed = () => screen.getByRole('button', { name: en.onboarding.continue })
    expect(proceed()).toBeDisabled()
    // One green button on the screen, and it is "Continue": "Add exam" is the secondary one of the card.
    expect(screen.getByRole('button', { name: t.add })).not.toHaveClass('bg-brand')

    await fillExam(user, 'אלגוריתמים')
    await user.click(screen.getByRole('button', { name: t.add }))
    await screen.findByRole('list', { name: t.listTitle })

    await waitFor(() => {
      expect(proceed()).toBeEnabled()
    })
    expect(proceed()).toHaveClass('bg-brand')
    expect(screen.getByRole('button', { name: t.add })).not.toHaveClass('bg-brand')
    await user.click(proceed())
    expect(await screen.findByText('materials')).toBeInTheDocument()
  })
})
