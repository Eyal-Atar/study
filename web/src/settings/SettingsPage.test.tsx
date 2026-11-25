import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Me, MePatch } from '../api/me'
import { codeText } from '../i18n/codes'
import { meTimeText } from '../commitments/model'
import { en } from '../i18n/en'
import { COMPLETED_AT, examFixture, meFixture, previewFixture } from '../test/onboardingFixtures'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import { createFakeStorage } from '../test/fakeStorage'
import { AppProviders } from '../app/AppProviders'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { ReplanOfferProvider } from '../plan/ReplanOffer'
import { SettingsPage } from './SettingsPage'

const t = en.settings.preferences
const s = en.settingsScreen
const r = s.prefs

function server(overrides: Partial<Me> = {}, planAffected = false) {
  const me = meFixture({ onboarding_completed_at: COMPLETED_AT, ...overrides })
  return createFakeApi()
    .on('GET /me', me)
    .on('GET /exams', [examFixture()])
    .on('GET /commitments', { commitments: [] })
    .on('PATCH /me', (call: ApiCall) => ({
      ...me,
      ...(call.body as MePatch),
      plan_affected: planAffected,
    }))
    .on('POST /plan/replan', previewFixture())
}

function open(fake: FakeApi, path = '/settings', queryClient?: QueryClient) {
  return renderRoute(path, {
    auth: createFakeAuth(fakeSession()),
    api: fake.api,
    ...(queryClient === undefined ? {} : { queryClient }),
  })
}

function group(name: string) {
  return screen.getByRole('radiogroup', { name })
}

// The rows of Study preferences are closed until pressed: a row is a button named by its title and
// its summary ("Hours a day 4 hours").
async function openRow(user: UserEvent, title: string) {
  const row = screen.getByRole('button', { name: new RegExp(`^${title}`) })
  if (row.getAttribute('aria-expanded') !== 'true') await user.click(row)
}

// The name of a row button: its title and its summary (the space between them is the browser's).
function rowName(title: string, summary: string) {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escape(title)}\\s*${escape(summary)}$`)
}

function hours() {
  return within(screen.getByRole('group', { name: t.hoursQuestion })).getByRole('status')
}

function saveButton() {
  return screen.getByRole('button', { name: t.save })
}

// A TimeField is a group named by its label, holding an hour and a minute segment (spinbuttons).
function timeField(name: string) {
  return screen.getByRole('group', { name })
}

// Types a whole 'HH:MM' into the two segments: the hour segment moves on to the minutes by itself.
async function setTime(user: UserEvent, name: string, time: string) {
  const [hour] = within(timeField(name)).getAllByRole('spinbutton') as [HTMLElement, HTMLElement]
  await user.click(hour)
  await user.keyboard(time.replace(':', ''))
}

async function ready() {
  await screen.findByRole('heading', { level: 1, name: en.settings.title })
  await screen.findByRole('button', { name: new RegExp(`^${r.hours}`) })
}

function patches(fake: FakeApi) {
  return fake.calls('PATCH', '/me').map((c) => c.body)
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('SettingsPage preferences', () => {
  it('shows the current values', async () => {
    open(
      server({
        wake_time: '07:30',
        sleep_time: '23:30',
        study_start_delay_minutes: 30,
        rest_days_before_exam: 2,
      }),
    )
    await ready()
    const user = userEvent.setup()
    for (const title of [r.hours, r.when, r.meTime, r.rest, r.day, r.delay]) await openRow(user, title)
    expect(hours()).toHaveTextContent(en.onboardingSchedule.hours(4))
    expect(screen.getByRole('checkbox', { name: new RegExp(en.onboardingSchedule.windows.morning.label) })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: new RegExp(en.onboardingSchedule.windows.afternoon.label) })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: new RegExp(en.onboardingSchedule.windows.evening.label) })).not.toBeChecked()
    expect(timeField(t.wakeTime)).toHaveTextContent('07:30')
    expect(timeField(t.sleepTime)).toHaveTextContent('23:30')
    expect(
      within(group(t.delayQuestion)).getByRole('radio', {
        name: en.settings.duration(30),
      }),
    ).toBeChecked()
    expect(within(group(t.restQuestion)).getByRole('radio', { name: t.restDays(2) })).toBeChecked()
    expect(screen.getByRole('switch', { name: t.hobbyLabel })).not.toBeChecked()
    expect(screen.queryByRole('group', { name: t.hobbyStart })).not.toBeInTheDocument()
  })

  it('keeps a current value that is not one of the choices selectable', async () => {
    open(
      server({
        daily_study_minutes: 150,
        study_start_delay_minutes: 200,
        rest_days_before_exam: 5,
      }),
    )
    await ready()
    const user = userEvent.setup()
    for (const title of [r.hours, r.rest, r.delay]) await openRow(user, title)
    expect(hours()).toHaveTextContent(en.settings.duration(150))
    expect(
      within(group(t.delayQuestion)).getByRole('radio', {
        name: en.settings.duration(200),
      }),
    ).toBeChecked()
    expect(within(group(t.restQuestion)).getByRole('radio', { name: t.restDays(5) })).toBeChecked()
  })

  it('nothing changed: "Save" is disabled and sends nothing', async () => {
    const user = userEvent.setup()
    const fake = server()
    open(fake)
    await ready()
    expect(saveButton()).toBeDisabled()
    await user.click(saveButton())
    expect(patches(fake)).toHaveLength(0)
  })

  it('sends only the changed fields', async () => {
    const user = userEvent.setup()
    const fake = server()
    open(fake)
    await ready()
    for (const title of [r.hours, r.when, r.rest, r.day, r.delay]) await openRow(user, title)
    await user.click(within(screen.getByRole('group', { name: t.hoursQuestion })).getByRole('button', { name: en.controls.stepper.less }))
    await setTime(user, t.wakeTime, '07:00')
    await user.click(screen.getByRole('checkbox', { name: new RegExp(en.onboardingSchedule.windows.evening.label) }))
    await user.click(
      within(group(t.delayQuestion)).getByRole('radio', {
        name: en.settings.duration(15),
      }),
    )
    await user.click(within(group(t.restQuestion)).getByRole('radio', { name: t.restDays(0) }))
    await user.click(saveButton())
    await waitFor(() => {
      expect(patches(fake)).toHaveLength(1)
    })
    expect(patches(fake)[0]).toEqual({
      daily_study_minutes: 180,
      wake_time: '07:00',
      study_windows: ['morning', 'afternoon', 'evening'],
      study_start_delay_minutes: 15,
      rest_days_before_exam: 0,
    })
  })

  it('a profile changed elsewhere refreshes the form, so a save does not send the old values back', async () => {
    const user = userEvent.setup()
    const fake = server()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    open(fake, '/settings', queryClient)
    await ready()
    expect(screen.getByRole('button', { name: rowName(r.hours, en.onboardingSchedule.hours(4)) })).toBeInTheDocument()

    fake.on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT, daily_study_minutes: 120 }))
    await queryClient.invalidateQueries()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: rowName(r.hours, en.onboardingSchedule.hours(2)) })).toBeInTheDocument()
    })
    expect(saveButton()).toBeDisabled()
    await user.click(saveButton())
    expect(patches(fake)).toHaveLength(0)
  })

  it('a change back to the current value sends nothing', async () => {
    const user = userEvent.setup()
    const fake = server()
    open(fake)
    await ready()
    await openRow(user, r.when)
    await user.click(screen.getByRole('checkbox', { name: new RegExp(en.onboardingSchedule.windows.evening.label) }))
    expect(saveButton()).toBeEnabled()
    await user.click(screen.getByRole('checkbox', { name: new RegExp(en.onboardingSchedule.windows.evening.label) }))
    expect(saveButton()).toBeDisabled()
  })

  it('plan_affected opens the replan offer with the reason', async () => {
    const user = userEvent.setup()
    const fake = server({}, true)
    open(fake)
    await ready()
    await openRow(user, r.hours)
    await user.click(within(screen.getByRole('group', { name: t.hoursQuestion })).getByRole('button', { name: en.controls.stepper.more }))
    await user.click(saveButton())
    const dialog = await screen.findByRole('dialog', { name: en.replan.title })
    expect(within(dialog).getByText(t.replanReason)).toBeInTheDocument()
    expect(fake.calls('POST', '/plan/replan').filter((c) => (c.body as { preview: boolean }).preview)).toHaveLength(1)
  })

  it('without plan_affected shows "Saved", and the form has nothing left to save', async () => {
    const user = userEvent.setup()
    const fake = server({}, false)
    open(fake)
    await ready()
    await openRow(user, r.hours)
    await user.click(within(screen.getByRole('group', { name: t.hoursQuestion })).getByRole('button', { name: en.controls.stepper.more }))
    await user.click(saveButton())
    expect(await screen.findByText(t.saved)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(saveButton()).toBeDisabled()
    })
  })

  it('turning the hobby on sends its start and length together', async () => {
    const user = userEvent.setup()
    const fake = server()
    open(fake)
    await ready()
    await openRow(user, r.meTime)
    await user.click(screen.getByRole('switch', { name: t.hobbyLabel }))
    await setTime(user, t.hobbyStart, '19:30')
    await user.click(
      within(group(t.hobbyMinutes)).getByRole('radio', {
        name: en.settings.duration(45),
      }),
    )
    await user.click(saveButton())
    await waitFor(() => {
      expect(patches(fake)).toHaveLength(1)
    })
    expect(patches(fake)[0]).toEqual({
      hobby_start: '19:30',
      hobby_minutes: 45,
    })
  })

  it('changing only the hobby length still sends both fields', async () => {
    const user = userEvent.setup()
    const fake = server({ hobby_start: '18:00', hobby_minutes: 60 })
    open(fake)
    await ready()
    await openRow(user, r.meTime)
    expect(screen.getByRole('switch', { name: t.hobbyLabel })).toBeChecked()
    expect(timeField(t.hobbyStart)).toHaveTextContent('18:00')
    await user.click(
      within(group(t.hobbyMinutes)).getByRole('radio', {
        name: en.settings.duration(90),
      }),
    )
    await user.click(saveButton())
    await waitFor(() => {
      expect(patches(fake)).toHaveLength(1)
    })
    expect(patches(fake)[0]).toEqual({
      hobby_start: '18:00',
      hobby_minutes: 90,
    })
  })

  it('turning the hobby off sends both as null', async () => {
    const user = userEvent.setup()
    const fake = server({ hobby_start: '18:00', hobby_minutes: 60 })
    open(fake)
    await ready()
    await openRow(user, r.meTime)
    await user.click(screen.getByRole('switch', { name: t.hobbyLabel }))
    await user.click(saveButton())
    await waitFor(() => {
      expect(patches(fake)).toHaveLength(1)
    })
    expect(patches(fake)[0]).toEqual({
      hobby_start: null,
      hobby_minutes: null,
    })
  })

  it('the same wake and sleep time is refused before sending', async () => {
    const user = userEvent.setup()
    const fake = server()
    open(fake)
    await ready()
    await openRow(user, r.day)
    await setTime(user, t.sleepTime, '08:00')
    await user.click(saveButton())
    expect(await screen.findByText(t.sameTimes)).toBeInTheDocument()
    expect(patches(fake)).toHaveLength(0)
  })

  it('a sleep time before the wake time says it is after midnight', async () => {
    open(
      server({
        wake_time: '16:00',
        sleep_time: '04:00',
        rest_days_before_exam: 1,
      }),
    )
    await ready()
    expect(screen.getByText(t.afterMidnight)).toBeInTheDocument()
    expect(screen.getByText(t.nightShiftRest)).toBeInTheDocument()
  })

  it('no after-midnight note for an ordinary day', async () => {
    open(server())
    await ready()
    expect(screen.queryByText(t.afterMidnight)).not.toBeInTheDocument()
  })

  it('every study window unchecked is refused before sending', async () => {
    const user = userEvent.setup()
    const fake = server({ study_windows: ['morning'] })
    open(fake)
    await ready()
    await openRow(user, r.when)
    await user.click(screen.getByRole('checkbox', { name: new RegExp(en.onboardingSchedule.windows.morning.label) }))
    await user.click(saveButton())
    expect(await screen.findByText(t.windowsRequired)).toBeInTheDocument()
    expect(patches(fake)).toHaveLength(0)
  })

  it('a validation_error from the server shows next to its field', async () => {
    const user = userEvent.setup()
    const fake = server().on(
      'PATCH /me',
      problem(422, 'validation_error', {
        errors: [{ loc: ['body', 'sleep_time'], type: 'same_as_wake_time' }],
      }),
    )
    open(fake)
    await ready()
    await openRow(user, r.day)
    await setTime(user, t.wakeTime, '07:00')
    await user.click(saveButton())
    const sleep = timeField(t.sleepTime)
    await waitFor(() => {
      // The description of a TimeField starts with the chosen time (React Aria), then the error.
      expect(sleep).toHaveAccessibleDescription(expect.stringContaining(t.sameTimes))
    })
    expect(sleep).toHaveAttribute('data-invalid', 'true')
    expect(timeField(t.wakeTime)).not.toHaveAccessibleDescription(expect.stringContaining(t.sameTimes))
  })

  it('a validation_error on a choice field shows under its group', async () => {
    const user = userEvent.setup()
    const fake = server().on(
      'PATCH /me',
      problem(422, 'validation_error', {
        errors: [{ loc: ['body', 'rest_days_before_exam'], type: 'less_than_equal' }],
      }),
    )
    open(fake)
    await ready()
    await openRow(user, r.rest)
    await user.click(within(group(t.restQuestion)).getByRole('radio', { name: t.restDays(3) }))
    await user.click(saveButton())
    await waitFor(() => {
      expect(group(t.restQuestion)).toHaveAccessibleDescription(t.invalidField)
    })
  })

  // Review Focus 4: the button is pending (not disabled) while the request is out.
  it('a double press on "Save" sends one request, and the button keeps its text', async () => {
    const user = userEvent.setup()
    let release: (value: unknown) => void = () => undefined
    const me = meFixture({ onboarding_completed_at: COMPLETED_AT })
    const fake = server().on('PATCH /me', () => new Promise((resolve) => (release = resolve)))
    open(fake)
    await ready()
    await openRow(user, r.hours)
    await user.click(within(screen.getByRole('group', { name: t.hoursQuestion })).getByRole('button', { name: en.controls.stepper.more }))
    await user.dblClick(saveButton())
    await user.click(saveButton())
    expect(patches(fake)).toHaveLength(1)
    expect(saveButton()).toBeInTheDocument()
    release({ ...me, daily_study_minutes: 300, plan_affected: false })
    expect(await screen.findByText(t.saved)).toBeInTheDocument()
  })

  // Decision 13: a cleared segment reports '', and the form keeps the last whole time.
  it('a cleared time segment does not change what is saved', async () => {
    const user = userEvent.setup()
    const fake = server()
    open(fake)
    await ready()
    await openRow(user, r.day)
    const [, minute] = within(timeField(t.wakeTime)).getAllByRole('spinbutton') as [HTMLElement, HTMLElement]
    await user.click(minute)
    await user.keyboard('{Backspace}{Backspace}')
    expect(saveButton()).toBeDisabled()
    await user.click(saveButton())
    expect(patches(fake)).toHaveLength(0)
  })

  it('the preferences are rows of one card, each with its summary, and one Save under it', async () => {
    open(server())
    await ready()
    const card = screen.getByRole('region', { name: t.title })
    const names = within(card)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(names).toEqual([
      `${r.hours} ${en.onboardingSchedule.hours(4)}`,
      `${r.when} ${[en.onboardingSchedule.windows.morning.label, en.onboardingSchedule.windows.afternoon.label].join(', ')}`,
      `${r.meTime} ${r.off}`,
      `${r.rest} ${t.restDays(1)}`,
      `${r.day} 08:00–23:00`,
      `${r.delay} ${en.settings.duration(60)}`,
    ])
    // The one Save sits under the card, not in it, and before Busy time.
    expect(within(card).queryByRole('button', { name: t.save })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: t.save })).toHaveLength(1)
    const busy = screen.getByRole('region', { name: s.busy.title })
    expect(card.compareDocumentPosition(saveButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(saveButton().compareDocumentPosition(busy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // Review Focus 5: a veteran's Me time is one row of the preferences, and not in Busy time.
  it('a veteran with Me time sees one row "Me time every day: 18:00, 1 hour" and no Me time in Busy time', async () => {
    const user = userEvent.setup()
    const days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      id: `m${String(weekday)}`,
      title: 'Me time',
      kind: 'other',
      weekday,
      start_time: '18:00',
      end_time: '19:00',
      valid_from: '2026-11-01',
      valid_until: null,
      source_job_id: null,
      created_at: '2026-11-01T08:00:00Z',
    }))
    const fake = server({ hobby_start: '18:00', hobby_minutes: 60 }).on('GET /commitments', { commitments: days })
    open(fake)
    await ready()
    const card = screen.getByRole('region', { name: t.title })
    expect(within(card).getByRole('button', { name: rowName(r.meTime, meTimeText('18:00', 60)) })).toBeInTheDocument()
    expect(meTimeText('18:00', 60)).toBe('18:00, 1 hour')
    const busy = screen.getByRole('region', { name: s.busy.title })
    await within(busy).findByText(s.busy.empty)
    expect(within(busy).queryByText(/Me time/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/Me time every day/)).toHaveLength(2)
    // Changing it and saving sends the pair and offers the replan.
    await openRow(user, r.meTime)
    await user.click(within(group(t.hobbyMinutes)).getByRole('radio', { name: en.settings.duration(90) }))
    await user.click(saveButton())
    await waitFor(() => {
      expect(patches(fake)).toEqual([{ hobby_start: '18:00', hobby_minutes: 90 }])
    })
  })

  it('a change to Me time that touches the plan offers the replan', async () => {
    const user = userEvent.setup()
    const fake = server({ hobby_start: '18:00', hobby_minutes: 60 }, true)
    open(fake)
    await ready()
    await openRow(user, r.meTime)
    await user.click(within(group(t.hobbyMinutes)).getByRole('radio', { name: en.settings.duration(30) }))
    await user.click(saveButton())
    const dialog = await screen.findByRole('dialog', { name: en.replan.title })
    expect(within(dialog).getByText(t.replanReason)).toBeInTheDocument()
  })

  it('a server error on the preferences keeps the row open and shows its message', async () => {
    const user = userEvent.setup()
    const fake = server().on('PATCH /me', problem(422, 'too_many_commitments'))
    open(fake)
    await ready()
    await openRow(user, r.meTime)
    await user.click(screen.getByRole('switch', { name: t.hobbyLabel }))
    await user.click(saveButton())
    expect(await screen.findByText(r.tooManyBusy)).toBeInTheDocument()
  })

  it('another failure shows its message', async () => {
    const user = userEvent.setup()
    const fake = server().on('PATCH /me', problem(503, 'database_unavailable'))
    open(fake)
    await ready()
    await openRow(user, r.hours)
    await user.click(within(screen.getByRole('group', { name: t.hoursQuestion })).getByRole('button', { name: en.controls.stepper.more }))
    await user.click(saveButton())
    expect(await screen.findByText(codeText('database_unavailable'))).toBeInTheDocument()
  })
})

describe('SettingsPage other sections', () => {
  it('the cards come in the order of the settings: preferences, Save, Busy time, Reminders, Appearance, account', async () => {
    open(server())
    await ready()
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(names).toEqual([t.title, s.busy.title, en.notifications.title, s.appearance.title, r.accountTitle])
  })

  it('Appearance sits after Reminders and before the account, also while the profile loads and when it fails', async () => {
    const regionNames = () => screen.getAllByRole('region').map((region) => within(region).queryAllByRole('heading', { level: 2 })[0]?.textContent)
    const expectOrder = () => {
      const names = regionNames()
      const reminders = names.indexOf(en.notifications.title)
      expect(reminders).toBeGreaterThanOrEqual(0)
      expect(names.indexOf(s.appearance.title)).toBe(reminders + 1)
      expect(names.indexOf(r.accountTitle)).toBe(reminders + 2)
    }

    open(server())
    await ready()
    expectOrder()
    cleanup()

    // The shell's gate waits for GET /me, so in the app this state is not reachable today; the page
    // is rendered on its own here to pin that the card never depends on the profile.
    const fake = server().on('GET /me', problem(503, 'database_unavailable'))
    const router = createMemoryRouter([{ path: '/settings', element: <SettingsPage /> }], { initialEntries: ['/settings'] })
    render(
      <AppProviders
        auth={createFakeAuth(fakeSession()).client}
        api={fake.api}
        storage={createFakeStorage().client}
        queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ReplanOfferProvider>
          <RouterProvider router={router} />
        </ReplanOfferProvider>
      </AppProviders>,
    )
    expect(screen.getByRole('radiogroup', { name: s.appearance.label })).toBeInTheDocument()
    expectOrder()
    expect(await within(screen.getByRole('region', { name: t.title })).findByText(codeText('database_unavailable'))).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: s.appearance.title })).getByRole('radiogroup', { name: s.appearance.label })).toBeInTheDocument()
    expectOrder()
  })

  it('hosts the reminder settings of S16 in one card, with no card inside it', async () => {
    open(server())
    await ready()
    // Without a VAPID key in the test env, the card says reminders are not set up here.
    const card = screen.getByRole('region', { name: en.notifications.title })
    expect(within(card).getByText(en.notifications.notConfigured)).toBeInTheDocument()
    expect(within(card).getByRole('radiogroup', { name: en.notifications.leadLabel })).toBeInTheDocument()
    expect(within(card).queryByRole('region')).not.toBeInTheDocument()
    expect(card.querySelectorAll('.rounded-card')).toHaveLength(0)
  })

  it('export downloads the JSON as studyflow-export-<local date>.json', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 16, 23, 30))
    const user = userEvent.setup()
    const data = {
      format: 'studyflow-export',
      version: 1,
      exams: [{ id: 'e1' }],
    }
    const fake = server().on('GET /me/export', data)
    const blobs: Blob[] = []
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:export'
    })
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const clicked: { download: string; href: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href })
    })
    open(fake)
    await ready()
    expect(document.getElementById('export')).toContainElement(screen.getByRole('button', { name: en.settings.export.button }))
    await user.click(screen.getByRole('button', { name: en.settings.export.button }))
    await waitFor(() => {
      expect(clicked).toHaveLength(1)
    })
    expect(fake.calls('GET', '/me/export')).toHaveLength(1)
    expect(clicked[0]).toEqual({
      download: 'studyflow-export-2026-11-16.json',
      href: 'blob:export',
    })
    expect(blobs[0]?.type).toBe('application/json')
    expect(await blobs[0]?.text()).toBe(JSON.stringify(data, null, 2))
    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
    })
  })

  it('a failed export shows a message', async () => {
    const user = userEvent.setup()
    const fake = server().on('GET /me/export', problem(503, 'database_unavailable'))
    open(fake)
    await ready()
    await user.click(screen.getByRole('button', { name: en.settings.export.button }))
    expect(await screen.findByText(codeText('database_unavailable'))).toBeInTheDocument()
  })

  it('the account card ends the screen: Export your data, then Delete my account in the danger colour', async () => {
    open(server())
    await ready()
    const account = screen.getByRole('region', { name: r.accountTitle })
    const regions = screen.getAllByRole('region')
    expect(regions.at(-1)).toBe(account)
    expect(account.className).not.toContain('bg-danger-soft')
    const del = within(account).getByRole('link', { name: new RegExp(en.settings.danger.link) })
    expect(del.className).toContain('text-danger')
    expect(within(account).getByText(en.settings.export.title)).toBeInTheDocument()
    const text = account.textContent
    expect(text.indexOf(en.settings.export.title)).toBeLessThan(text.indexOf(en.settings.danger.link))
  })

  it('the danger zone links to the account deletion page', async () => {
    const user = userEvent.setup()
    const { router } = open(server())
    await ready()
    await user.click(screen.getByRole('link', { name: new RegExp(en.settings.danger.link) }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings/delete-account')
    })
  })
})
