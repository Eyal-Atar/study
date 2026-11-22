import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { describe, expect, it } from 'vitest'
import type { Me, MePatch } from '../api/me'
import { AppProviders } from '../app/AppProviders'
import { en } from '../i18n/en'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { createFakeStorage } from '../test/fakeStorage'
import { ScheduleStep } from './ScheduleStep'
import { STEP_PATHS } from './steps'

const t = en.onboardingSchedule

const me: Me = {
  id: 'user-a',
  email: 'a@example.com',
  display_name: null,
  timezone: 'Asia/Jerusalem',
  wake_time: '08:00',
  sleep_time: '23:00',
  daily_study_minutes: 240,
  study_windows: ['morning', 'afternoon'],
  rest_days_before_exam: 1,
  notify_lead_minutes: 10,
  study_start_delay_minutes: 60,
  hobby_start: null,
  hobby_minutes: null,
  onboarding_completed_at: null,
}

function isoInDays(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const exam = { id: 'e1', name: 'Calculus', exam_date: isoInDays(12), difficulty: 3, created_at: '2026-11-16T08:00:00Z', color_index: 0 }

function meApi(profile: Me = me) {
  return createFakeApi()
    .on('GET /me', profile)
    .on('GET /exams', [exam])
    .on('PATCH /me', (call: ApiCall) => ({ ...profile, ...(call.body as MePatch), plan_affected: false }))
}

function renderSchedule(fake: FakeApi) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: STEP_PATHS.schedule, element: <ScheduleStep /> },
      { path: STEP_PATHS.materials, element: <p>materials</p> },
      { path: STEP_PATHS.fixedHours, element: <p>fixed hours</p> },
    ],
    { initialEntries: [STEP_PATHS.schedule] },
  )
  const view = render(
    <AppProviders
      auth={createFakeAuth(fakeSession()).client}
      api={fake.api}
      storage={createFakeStorage().client}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return Object.assign(router, { container: view.container })
}

const windowName = (w: keyof typeof t.windows) => new RegExp(t.windows[w].label)

const more = () => screen.getByRole('button', { name: en.controls.stepper.more })
const less = () => screen.getByRole('button', { name: en.controls.stepper.less })
// The stepper's value is an <output>, which is a status too: Archi's note is the other one.
const noteRegion = () => {
  const region = screen.getAllByRole('status').find((element) => element.tagName !== 'OUTPUT')
  if (region === undefined) throw new Error('no note region')
  return region
}
const hoursValue = (hours: number) => screen.getByText(t.hours(hours))

const follows = (first: Element, second: Element) =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

describe('ScheduleStep', () => {
  it('starts from the profile: 4 hours, morning and afternoon', async () => {
    renderSchedule(meApi())
    expect(await screen.findByText(t.hours(4))).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: t.hoursQuestion })).toBeInTheDocument()
    expect(screen.getByText(en.onboarding.stepOf(3, 4))).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: windowName('morning') })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: windowName('afternoon') })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: windowName('evening') })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: windowName('night') })).not.toBeChecked()
  })

  it('a profile amount that is not an option falls back to 4 hours', async () => {
    renderSchedule(meApi({ ...me, daily_study_minutes: 150, study_windows: ['evening'] }))
    expect(await screen.findByText(t.hours(4))).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: windowName('evening') })).toBeChecked()
  })

  it('"Continue" sends one PATCH /me with the answers and goes to the fixed hours step', async () => {
    const user = userEvent.setup()
    const fake = meApi()
    renderSchedule(fake)

    await screen.findByText(t.hours(4))
    await user.click(more())
    await user.click(more())
    expect(hoursValue(6)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: windowName('morning') }))
    await user.click(screen.getByRole('checkbox', { name: windowName('evening') }))
    await user.click(screen.getByRole('button', { name: en.onboarding.continue }))

    expect(await screen.findByText('fixed hours')).toBeInTheDocument()
    expect(fake.calls('PATCH', '/me')).toHaveLength(1)
    const body = fake.calls('PATCH', '/me').at(0)?.body as MePatch
    expect(body.daily_study_minutes).toBe(360)
    expect([...(body.study_windows ?? [])].sort()).toEqual(['afternoon', 'evening'])
  })

  it('without a window: an alert and no API call', async () => {
    const user = userEvent.setup()
    const fake = meApi()
    renderSchedule(fake)

    await user.click(await screen.findByRole('checkbox', { name: windowName('morning') }))
    await user.click(screen.getByRole('checkbox', { name: windowName('afternoon') }))
    await user.click(screen.getByRole('button', { name: en.onboarding.continue }))

    expect(await screen.findByRole('alert')).toHaveTextContent(t.windowsRequired)
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('choosing night shows the midnight note', async () => {
    const user = userEvent.setup()
    renderSchedule(meApi())
    await screen.findByRole('checkbox', { name: windowName('night') })
    expect(screen.queryByText(t.nightNote)).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: windowName('night') }))
    expect(screen.getByText(t.nightNote)).toBeInTheDocument()
  })

  it('an API error is shown, and the step stays', async () => {
    const user = userEvent.setup()
    const fake = meApi().on('PATCH /me', problem(503, 'database_unavailable'))
    renderSchedule(fake)

    await user.click(await screen.findByRole('button', { name: en.onboarding.continue }))
    expect(await screen.findByRole('alert')).toHaveTextContent(en.codes.database_unavailable)
    expect(screen.queryByText('fixed hours')).not.toBeInTheDocument()
  })

  it('a double press on "Continue" saves once, and the button keeps its text', async () => {
    const user = userEvent.setup()
    const fake = meApi()
    let answer: () => void = () => undefined
    fake.on(
      'PATCH /me',
      () =>
        new Promise((resolve) => {
          answer = () => {
            resolve(me)
          }
        }),
    )
    renderSchedule(fake)

    const build = await screen.findByRole('button', { name: en.onboarding.continue })
    await user.dblClick(build)
    await user.click(build)

    expect(fake.calls('PATCH', '/me')).toHaveLength(1)
    expect(build).toHaveTextContent(en.onboarding.continue)
    answer()
    expect(await screen.findByText('fixed hours')).toBeInTheDocument()
    expect(fake.calls('PATCH', '/me')).toHaveLength(1)
  })

  it('the primary button comes first, and each window shows its hours left to right', async () => {
    renderSchedule(meApi())
    const build = await screen.findByRole('button', { name: en.onboarding.continue })
    const bar = build.parentElement
    if (bar === null) throw new Error('no actions bar')
    // The bottom holds only the way forward; "Back" is at the top (S34 decision 9).
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual([en.onboarding.continue])
    expect(follows(screen.getByRole('button', { name: en.common.back }), screen.getByRole('heading', { level: 1 }))).toBe(true)
    // The page is LTR, so a range needs no isolate marks: it reads left to right as it is.
    expect(screen.getByText('06:00–12:00')).toBeInTheDocument()
    expect(screen.getByText('21:00–02:00')).toBeInTheDocument()
  })

  it('"back" goes to the materials step', async () => {
    const user = userEvent.setup()
    renderSchedule(meApi())
    // "Back" is part of the frame, so it is there before the profile is: wait for the form.
    await screen.findByText(t.hours(4))
    await user.click(screen.getByRole('button', { name: en.common.back }))
    expect(await screen.findByText('materials')).toBeInTheDocument()
  })

  it('a failed profile load shows the error and a retry', async () => {
    const user = userEvent.setup()
    const fake = createFakeApi().on('GET /me', problem(503, 'database_unavailable'))
    renderSchedule(fake)
    expect(await screen.findByRole('alert')).toHaveTextContent(en.codes.database_unavailable)
    fake.on('GET /me', me)
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    await waitFor(() => {
      expect(screen.getByText(t.hours(4))).toBeInTheDocument()
    })
  })

  it('"More" raises to 5 hours and Archi’s note about the exam changes with it', async () => {
    const user = userEvent.setup()
    renderSchedule(meApi())
    await screen.findByText(t.hours(4))
    const note = noteRegion()
    await waitFor(() => {
      expect(note).not.toBeEmptyDOMElement()
    })
    const before = note.textContent

    await user.click(more())
    expect(hoursValue(5)).toBeInTheDocument()
    expect(note.textContent).not.toBe(before)
    expect(note).toHaveTextContent(/study hours/)

    // The choice also follows "Less", and the profile is never saved by choosing.
    await user.click(less())
    expect(note.textContent).toBe(before)
  })

  it('the note follows the windows being chosen, not the saved ones', async () => {
    const user = userEvent.setup()
    const fake = meApi()
    renderSchedule(fake)
    await screen.findByText(t.hours(4))
    const note = noteRegion()
    await waitFor(() => {
      expect(note).not.toBeEmptyDOMElement()
    })
    await user.click(more())
    await user.click(more())
    const before = note.textContent

    // Only the evening is left: a shorter day than morning and afternoon together.
    await user.click(screen.getByRole('checkbox', { name: windowName('evening') }))
    await user.click(screen.getByRole('checkbox', { name: windowName('morning') }))
    await user.click(screen.getByRole('checkbox', { name: windowName('afternoon') }))
    expect(note.textContent).not.toBe(before)
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('shows the windows question with its hint, and no note when there are no exams', async () => {
    renderSchedule(meApi().on('GET /exams', []))
    await screen.findByText(t.hours(4))
    expect(screen.getByRole('group', { name: t.windowsQuestion })).toHaveAccessibleDescription(t.windowsHint)
    expect(noteRegion()).toBeEmptyDOMElement()
  })

  it('the layout stays the same element while the profile loads', async () => {
    let release: (value: Me) => void = () => undefined
    const fake = meApi().on(
      'GET /me',
      () =>
        new Promise<Me>((resolve) => {
          release = resolve
        }),
    )
    const { container } = renderSchedule(fake)
    await waitFor(() => {
      expect(fake.calls('GET', '/me')).toHaveLength(1)
    })
    const heading = await screen.findByRole('heading', { level: 1, name: t.hoursQuestion })
    const answer = container.querySelector('[data-part="answer"]')
    expect(answer).not.toBeNull()
    expect(screen.queryByText(t.hours(4))).not.toBeInTheDocument()

    release(me)
    expect(await screen.findByText(t.hours(4))).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: t.hoursQuestion })).toBe(heading)
    expect(container.querySelector('[data-part="answer"]')).toBe(answer)
  })
})
