import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../app/AppProviders'
import type { Commitment, CommitmentInput } from '../availability/types'
import { groupCommitments, groupSubtitle } from '../commitments/model'
import { todayIn } from '../exam/dates'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { BROWSER_ZONE, meFixture } from '../test/onboardingFixtures'
import { FixedHoursStep } from './FixedHoursStep'
import { clearMarkedCells, markedCells } from './markedHours'
import { flushDeletes, sendDelete, waitToDelete } from './pendingDeletes'
import { STEP_PATHS } from './steps'

const t = en.onboardingFlow.fixedHours
const painter = en.commitments.painter
const WORK = 'משמרת עבודה'

const pad = (n: number) => String(n).padStart(2, '0')
const cellName = (day: number, hour: number) => painter.cell(en.commitments.weekdayLong[day] ?? '', `${pad(hour)}:00`)
const savedName = (day: number, hour: number) => painter.cellSaved(en.commitments.weekdayLong[day] ?? '', `${pad(hour)}:00`)

function isoInDays(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const row = (id: string, weekday: Commitment['weekday'], extra: Partial<Commitment> = {}): Commitment => ({
  id,
  title: WORK,
  kind: 'work',
  weekday,
  start_time: '14:00',
  end_time: '17:00',
  valid_from: '2026-11-01',
  valid_until: null,
  source_job_id: null,
  created_at: '2026-11-01T08:00:00Z',
  ...extra,
})

// A server that keeps its commitments, as the API does: a POST adds a row with a new id, a DELETE
// removes one. `postReply` can turn a POST into a problem.
function server(initial: Commitment[] = [], examDate = isoInDays(30)) {
  const state = { store: [...initial], next: 100, postReply: (() => null) as (call: ApiCall) => unknown }
  const fake = createFakeApi()
    .on('GET /me', meFixture())
    .on('GET /exams', [{ id: 'e1', name: 'Calculus', exam_date: examDate, difficulty: 3, created_at: '2026-11-16T08:00:00Z', color_index: 0 }])
    .on('GET /commitments', () => ({ commitments: state.store }))
    .on('POST /commitments', (call: ApiCall) => {
      const failure = state.postReply(call)
      if (failure !== null) return failure
      const body = call.body as CommitmentInput
      state.next += 1
      const created = row(`n${String(state.next)}`, body.weekday, { ...body, valid_from: body.valid_from ?? '2026-11-22', valid_until: body.valid_until ?? null })
      state.store = [...state.store, created]
      return { commitment: created, plan_affected: false }
    })
    .on({ method: 'DELETE', path: /^\/commitments\// }, (call: ApiCall) => {
      const id = call.path.split('/').at(-1)
      state.store = state.store.filter((c) => c.id !== id)
      return { plan_affected: false }
    })
  return { fake, state }
}

function renderStep(fake: FakeApi) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: STEP_PATHS.fixedHours, element: <FixedHoursStep /> },
      { path: STEP_PATHS.schedule, element: <p>schedule</p> },
      { path: STEP_PATHS.building, element: <p>building</p> },
    ],
    { initialEntries: [STEP_PATHS.fixedHours] },
  )
  const view = render(
    <AppProviders auth={createFakeAuth(fakeSession()).client} api={fake.api} storage={createFakeStorage().client} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return Object.assign(router, { unmount: view.unmount })
}

const yes = () => screen.findByRole('button', { name: t.yes })
const no = () => screen.findByRole('button', { name: t.no })
const build = () => screen.getByRole('button', { name: en.onboardingSchedule.build })
const noteRegion = () => {
  const region = screen.getAllByRole('status').find((element) => element.getAttribute('aria-live') === 'polite')
  if (region === undefined) throw new Error('no note region')
  return region
}

beforeEach(async () => {
  // A delete left waiting by an earlier test would leak into this one, and so would marked hours.
  await flushDeletes()
  clearMarkedCells()
})

describe('FixedHoursStep', () => {
  it('asks its question as the one h1, at step 4 of 4, with the two answers and neither chosen', async () => {
    renderStep(server().fake)
    expect(screen.getByRole('heading', { level: 1, name: t.question })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText(en.onboarding.stepOf(4, 4))).toBeInTheDocument()
    expect(screen.getByText(t.below)).toBeInTheDocument()
    expect(await no()).toHaveAttribute('aria-pressed', 'false')
    expect(await yes()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('"No, I’m flexible" goes to the build with one press and sends nothing', async () => {
    const user = userEvent.setup()
    const { fake } = server()
    const router = renderStep(fake)
    await user.click(await no())
    expect(await screen.findByText('building')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(STEP_PATHS.building)
    expect(fake.calls('POST')).toHaveLength(0)
    expect(fake.calls('DELETE')).toHaveLength(0)
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('"Yes, I do" opens the small week from the wake hour to the sleep hour', async () => {
    const user = userEvent.setup()
    renderStep(server().fake)
    await user.click(await yes())
    expect(screen.getByRole('button', { name: t.yes })).toHaveAttribute('aria-pressed', 'true')
    const grid = screen.getByRole('grid', { name: painter.label })
    // 08:00–23:00 of the profile: a header row and 15 hours.
    expect(within(grid).getAllByRole('row')).toHaveLength(1 + 15)
    expect(screen.getByRole('button', { name: cellName(0, 8) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: cellName(0, 22) })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: cellName(0, 23) })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.commitments.timetable.upload })).toBeInTheDocument()
  })

  it('"Add exact hours" opens the dialog', async () => {
    const user = userEvent.setup()
    renderStep(server().fake)
    await user.click(await yes())
    await user.click(screen.getByRole('button', { name: t.addExact }))
    expect(await screen.findByRole('dialog', { name: en.commitments.dialog.titleAdd })).toBeInTheDocument()
  })

  it('10:00–12:00 marked on Sunday and "Build my plan": one POST, then the build', async () => {
    const user = userEvent.setup()
    const { fake } = server()
    const router = renderStep(fake)
    await user.click(await yes())
    await user.click(screen.getByRole('button', { name: cellName(0, 10) }))
    await user.click(screen.getByRole('button', { name: cellName(0, 11) }))
    await user.click(build())

    expect(await screen.findByText('building')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(STEP_PATHS.building)
    expect(fake.calls('POST', '/commitments').map((c) => c.body)).toEqual([
      {
        title: en.commitments.defaultTitle,
        kind: 'other',
        weekday: 0,
        start_time: '10:00',
        end_time: '12:00',
        valid_from: todayIn(BROWSER_ZONE),
      },
    ])
    expect(en.commitments.defaultTitle).toBe('Busy')
  })

  it.each([
    ['too_many_commitments', problem(409, 'too_many_commitments')],
    ['the network', problem(0, 'network')],
  ])(
    'a second POST that fails (%s): the first shows as saved, the second stays marked, a message, and a retry sends only the second',
    async (_name, failure) => {
      const user = userEvent.setup()
      const { fake, state } = server()
      const router = renderStep(fake)
      state.postReply = (call) => ((call.body as CommitmentInput).weekday === 1 ? failure : null)
      await user.click(await yes())
      await user.click(screen.getByRole('button', { name: cellName(0, 10) }))
      await user.click(screen.getByRole('button', { name: cellName(1, 14) }))
      await user.click(build())

      expect(await screen.findByRole('alert')).toHaveTextContent(t.saveFailed)
      expect(router.state.location.pathname).toBe(STEP_PATHS.fixedHours)
      expect(fake.calls('POST', '/commitments')).toHaveLength(2)
      // What went through is saved, in the week and in the list.
      expect(await screen.findByRole('button', { name: savedName(0, 10) })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: cellName(0, 10) })).not.toBeInTheDocument()
      expect(screen.getByRole('list', { name: t.savedLabel })).toHaveTextContent(en.commitments.defaultTitle)
      // What failed is still marked, and not saved.
      expect(screen.getByRole('button', { name: cellName(1, 14) })).toHaveAttribute('aria-pressed', 'true')

      state.postReply = () => null
      await user.click(build())
      expect(await screen.findByText('building')).toBeInTheDocument()
      const posts = fake.calls('POST', '/commitments')
      expect(posts).toHaveLength(3)
      expect(posts.at(-1)?.body).toMatchObject({ weekday: 1, start_time: '14:00', end_time: '15:00' })
      // No duplicate: Sunday was sent once.
      expect(posts.filter((c) => (c.body as CommitmentInput).weekday === 0)).toHaveLength(1)
    },
  )

  it('a saved commitment shows as saved, "Yes" is chosen at once, and it can be deleted from the list', async () => {
    const user = userEvent.setup()
    const existing = [row('c1', 0), row('c2', 2)]
    const { fake } = server(existing)
    renderStep(fake)

    expect(await screen.findByRole('button', { name: t.yes })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: savedName(0, 14) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: savedName(2, 16) })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: t.savedLabel })
    expect(list).toHaveTextContent(WORK)
    const [group] = groupCommitments(existing)
    if (group === undefined) throw new Error('no group')
    expect(list).toHaveTextContent(groupSubtitle(group))

    await user.click(screen.getByRole('button', { name: t.remove(WORK, groupSubtitle(group)) }))
    await waitFor(() => {
      expect(screen.queryByRole('list', { name: t.savedLabel })).not.toBeInTheDocument()
    })
    expect(fake.calls('DELETE').map((c) => c.path).sort()).toEqual(['/commitments/c1', '/commitments/c2'])
    expect(screen.getByRole('button', { name: cellName(0, 14) })).toHaveAttribute('aria-pressed', 'false')
  })

  it('a failed delete in the list says so and shows what is really there', async () => {
    const user = userEvent.setup()
    const { fake } = server([row('c1', 0)])
    fake.on({ method: 'DELETE', path: /^\/commitments\// }, problem(503, 'database_unavailable'))
    renderStep(fake)
    const [group] = groupCommitments([row('c1', 0)])
    if (group === undefined) throw new Error('no group')
    await user.click(await screen.findByRole('button', { name: t.remove(WORK, groupSubtitle(group)) }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t.removeFailed)
    expect(screen.getByRole('list', { name: t.savedLabel })).toHaveTextContent(WORK)
  })

  it('the live note counts the hours marked and not yet saved', async () => {
    const user = userEvent.setup()
    // The exam is in three days with one rest day: tomorrow is the only study day.
    const { fake } = server([], isoInDays(3))
    renderStep(fake)
    await user.click(await yes())
    const note = noteRegion()
    await waitFor(() => {
      expect(note).not.toBeEmptyDOMElement()
    })
    expect(note).not.toHaveTextContent(en.onboardingFlow.feasibility.none('Calculus'))

    // Tomorrow's study hours (09:00–17:00: the morning and the afternoon, an hour after waking), all marked.
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    for (let hour = 9; hour < 17; hour += 1) {
      await user.click(screen.getByRole('button', { name: cellName(tomorrow.getDay(), hour) }))
    }
    expect(note).toHaveTextContent(en.onboardingFlow.feasibility.none('Calculus'))
    expect(fake.calls('POST')).toHaveLength(0)
  })

  it('a material delete that fails when leaving keeps the student here with a message ("No")', async () => {
    const user = userEvent.setup()
    const { fake } = server()
    const router = renderStep(fake)
    await no()
    // A file deleted in step 2 whose undo toast is still open: leaving sends its DELETE, which fails.
    waitToDelete('m1', () => {
      sendDelete('m1', () => Promise.resolve(false))
    })
    await user.click(await no())
    expect(await screen.findByRole('alert')).toHaveTextContent(t.deletesFailed)
    expect(router.state.location.pathname).toBe(STEP_PATHS.fixedHours)
  })

  it('the waiting material deletes are sent before "Build my plan" leaves, and a failed one keeps the step', async () => {
    const user = userEvent.setup()
    const { fake } = server()
    const router = renderStep(fake)
    await user.click(await yes())
    await user.click(screen.getByRole('button', { name: cellName(0, 10) }))
    let sent = 0
    waitToDelete('m2', () => {
      sendDelete('m2', () => {
        sent += 1
        return Promise.resolve(false)
      })
    })
    await user.click(build())
    expect(await screen.findByRole('alert')).toHaveTextContent(t.deletesFailed)
    expect(sent).toBe(1)
    expect(router.state.location.pathname).toBe(STEP_PATHS.fixedHours)
    // The busy hours went through all the same, and a second press sends no duplicate.
    expect(fake.calls('POST', '/commitments')).toHaveLength(1)
    await user.click(build())
    expect(await screen.findByText('building')).toBeInTheDocument()
    expect(fake.calls('POST', '/commitments')).toHaveLength(1)
  })

  it('"Yes", hours marked, then "No": nothing is saved and the build starts', async () => {
    const user = userEvent.setup()
    const { fake } = server()
    const router = renderStep(fake)
    await user.click(await yes())
    await user.click(screen.getByRole('button', { name: cellName(0, 10) }))
    await user.click(screen.getByRole('button', { name: t.no }))
    expect(await screen.findByText('building')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(STEP_PATHS.building)
    expect(fake.calls('POST')).toHaveLength(0)
  })

  it('after a partial failure, "No" sends no further POST', async () => {
    const user = userEvent.setup()
    const { fake, state } = server()
    renderStep(fake)
    state.postReply = (call) => ((call.body as CommitmentInput).weekday === 1 ? problem(409, 'too_many_commitments') : null)
    await user.click(await yes())
    await user.click(screen.getByRole('button', { name: cellName(0, 10) }))
    await user.click(screen.getByRole('button', { name: cellName(1, 14) }))
    await user.click(build())
    const alert = await screen.findByRole('alert')
    // The title says what happened to the marked hours; S32's text of the code says why.
    expect(alert).toHaveTextContent(t.saveFailed)
    expect(alert).toHaveTextContent(codeText('too_many_commitments'))
    expect(fake.calls('POST', '/commitments')).toHaveLength(2)

    state.postReply = () => null
    await user.click(screen.getByRole('button', { name: t.no }))
    expect(await screen.findByText('building')).toBeInTheDocument()
    expect(fake.calls('POST', '/commitments')).toHaveLength(2)
  })

  it('a returning user’s Me time counts in the estimate, but is neither a saved cell nor a row', async () => {
    const meTime = ([0, 1, 2, 3, 4, 5, 6] as const).map((d) =>
      row(`m${String(d)}`, d, { title: 'Me time', kind: 'other', start_time: '09:00', end_time: '13:00' }),
    )
    // The exam is in three days with one rest day: tomorrow is the only study day.
    const examDate = isoInDays(3)
    // A day of 8 study hours, so 4 hours of Me time leave less than the daily amount.
    const profile = meFixture({ daily_study_minutes: 480 })
    const first = renderStep(server([], examDate).fake.on('GET /me', profile))
    await no()
    const note = noteRegion()
    await waitFor(() => {
      expect(note).not.toBeEmptyDOMElement()
    })
    const without = note.textContent
    first.unmount()

    const user = userEvent.setup()
    renderStep(server(meTime, examDate).fake.on('GET /me', profile))
    // Nothing but Me time is saved, so "Yes" is not chosen for the student.
    expect(await screen.findByRole('button', { name: t.yes })).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => {
      expect(noteRegion()).not.toBeEmptyDOMElement()
    })
    expect(noteRegion().textContent).not.toBe(without)

    await user.click(screen.getByRole('button', { name: t.yes }))
    expect(screen.getByRole('button', { name: cellName(0, 10) })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: savedName(0, 10) })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: t.savedLabel })).not.toBeInTheDocument()
  })

  it('hours marked, then saved through the dialog and deleted from the list, are not sent by "Build my plan"', async () => {
    const user = userEvent.setup()
    const { fake } = server()
    renderStep(fake)
    await user.click(await yes())
    await user.click(screen.getByRole('button', { name: cellName(0, 10) }))

    // The same hour, saved with exact hours.
    const dialogText = en.commitments.dialog
    await user.click(screen.getByRole('button', { name: t.addExact }))
    const dialog = await screen.findByRole('dialog', { name: dialogText.titleAdd })
    await user.type(within(dialog).getByRole('textbox', { name: dialogText.name }), WORK)
    await user.click(within(dialog).getByRole('checkbox', { name: en.commitments.weekdayLong[0] }))
    for (const [label, hh] of [[dialogText.from, '10'], [dialogText.to, '11']] as const) {
      const [hour, minute] = within(within(dialog).getByRole('group', { name: label })).getAllByRole('spinbutton') as [HTMLElement, HTMLElement]
      await user.click(hour)
      await user.keyboard(hh)
      await user.click(minute)
      await user.keyboard('00')
    }
    await user.click(within(dialog).getByRole('button', { name: en.common.save }))
    expect(await screen.findByRole('button', { name: savedName(0, 10) })).toBeInTheDocument()
    expect(fake.calls('POST', '/commitments')).toHaveLength(1)

    // Deleted from the list: the hour is free, and no longer marked either.
    const list = screen.getByRole('list', { name: t.savedLabel })
    await user.click(within(list).getByRole('button'))
    await waitFor(() => {
      expect(screen.queryByRole('list', { name: t.savedLabel })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: cellName(0, 10) })).toHaveAttribute('aria-pressed', 'false')

    await user.click(build())
    expect(await screen.findByText('building')).toBeInTheDocument()
    expect(fake.calls('POST', '/commitments')).toHaveLength(1)
  })

  it('the answer buttons change colour only inside motion-safe, so reduced motion has no transition', async () => {
    renderStep(server().fake)
    for (const button of [await no(), await yes()]) {
      const motion = (button.getAttribute('class') ?? '').split(/\s+/).filter((c) => /transition|duration|ease|animate/.test(c))
      expect(motion.length).toBeGreaterThan(0)
      for (const c of motion) expect(c.startsWith('motion-safe:')).toBe(true)
    }
  })

  it('hours marked and not saved survive "Back" and the return, and nothing is sent', async () => {
    const user = userEvent.setup()
    const { fake } = server()
    const router = renderStep(fake)
    await user.click(await yes())
    await user.click(screen.getByRole('button', { name: cellName(0, 10) }))
    await user.click(screen.getByRole('button', { name: en.common.back }))
    expect(await screen.findByText('schedule')).toBeInTheDocument()

    await router.navigate(STEP_PATHS.fixedHours)
    expect(await yes()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: cellName(0, 10) })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: cellName(0, 11) })).toHaveAttribute('aria-pressed', 'false')
    expect(fake.calls('POST')).toHaveLength(0)
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('"No, I’m flexible" forgets the marked hours', async () => {
    const user = userEvent.setup()
    renderStep(server().fake)
    await user.click(await yes())
    await user.click(screen.getByRole('button', { name: cellName(0, 10) }))
    expect(markedCells().size).toBe(1)
    await user.click(screen.getByRole('button', { name: t.no }))
    expect(await screen.findByText('building')).toBeInTheDocument()
    expect(markedCells().size).toBe(0)
  })

  it('the marked hours that "Build my plan" saved are no longer marked', async () => {
    const user = userEvent.setup()
    renderStep(server().fake)
    await user.click(await yes())
    await user.click(screen.getByRole('button', { name: cellName(0, 10) }))
    await user.click(build())
    expect(await screen.findByText('building')).toBeInTheDocument()
    expect(markedCells().size).toBe(0)
  })

  it('"Back" goes to step 3', async () => {
    const user = userEvent.setup()
    renderStep(server().fake)
    await no()
    await user.click(screen.getByRole('button', { name: en.common.back }))
    expect(await screen.findByText('schedule')).toBeInTheDocument()
  })
})
