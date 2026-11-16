import { QueryClient } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Me, MePatch } from '../api/me'
import { codeText } from '../i18n/codes'
import { he } from '../i18n/he'
import { COMPLETED_AT, examFixture, meFixture, previewFixture } from '../onboarding/testFixtures'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

const t = he.settings.preferences

function server(overrides: Partial<Me> = {}, planAffected = false) {
  const me = meFixture({ onboarding_completed_at: COMPLETED_AT, ...overrides })
  return createFakeApi()
    .on('GET /me', me)
    .on('GET /exams', [examFixture()])
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

function saveButton() {
  return screen.getByRole('button', { name: t.save })
}

async function ready() {
  await screen.findByRole('heading', { level: 1, name: he.settings.title })
  await screen.findByLabelText(t.wakeTime)
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
    expect(
      within(group(t.hoursQuestion)).getByRole('radio', {
        name: he.onboardingSchedule.hours(4),
      }),
    ).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /בוקר/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /צהריים/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /ערב/ })).not.toBeChecked()
    expect(screen.getByLabelText(t.wakeTime)).toHaveValue('07:30')
    expect(screen.getByLabelText(t.sleepTime)).toHaveValue('23:30')
    expect(
      within(group(t.delayQuestion)).getByRole('radio', {
        name: he.settings.duration(30),
      }),
    ).toBeChecked()
    expect(within(group(t.restQuestion)).getByRole('radio', { name: t.restDays(2) })).toBeChecked()
    expect(screen.getByRole('switch', { name: t.hobbyLabel })).not.toBeChecked()
    expect(screen.queryByLabelText(t.hobbyStart)).not.toBeInTheDocument()
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
    expect(
      within(group(t.hoursQuestion)).getByRole('radio', {
        name: he.settings.duration(150),
      }),
    ).toBeChecked()
    expect(
      within(group(t.delayQuestion)).getByRole('radio', {
        name: he.settings.duration(200),
      }),
    ).toBeChecked()
    expect(within(group(t.restQuestion)).getByRole('radio', { name: t.restDays(5) })).toBeChecked()
  })

  it('nothing changed: "שמירה" is disabled and sends nothing', async () => {
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
    await user.click(
      within(group(t.hoursQuestion)).getByRole('radio', {
        name: he.onboardingSchedule.hours(3),
      }),
    )
    fireEvent.change(screen.getByLabelText(t.wakeTime), {
      target: { value: '07:00' },
    })
    await user.click(screen.getByRole('checkbox', { name: /ערב/ }))
    await user.click(
      within(group(t.delayQuestion)).getByRole('radio', {
        name: he.settings.duration(15),
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
    expect(within(group(t.hoursQuestion)).getByRole('radio', { name: he.onboardingSchedule.hours(4) })).toBeChecked()

    fake.on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT, daily_study_minutes: 120 }))
    await queryClient.invalidateQueries()
    await waitFor(() => {
      expect(within(group(t.hoursQuestion)).getByRole('radio', { name: he.onboardingSchedule.hours(2) })).toBeChecked()
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
    await user.click(screen.getByRole('checkbox', { name: /ערב/ }))
    expect(saveButton()).toBeEnabled()
    await user.click(screen.getByRole('checkbox', { name: /ערב/ }))
    expect(saveButton()).toBeDisabled()
  })

  it('plan_affected opens the replan offer with the reason', async () => {
    const user = userEvent.setup()
    const fake = server({}, true)
    open(fake)
    await ready()
    await user.click(
      within(group(t.hoursQuestion)).getByRole('radio', {
        name: he.onboardingSchedule.hours(5),
      }),
    )
    await user.click(saveButton())
    const dialog = await screen.findByRole('dialog', { name: he.replan.title })
    expect(within(dialog).getByText(t.replanReason)).toBeInTheDocument()
    expect(fake.calls('POST', '/plan/replan').filter((c) => (c.body as { preview: boolean }).preview)).toHaveLength(1)
  })

  it('without plan_affected shows "נשמר", and the form has nothing left to save', async () => {
    const user = userEvent.setup()
    const fake = server({}, false)
    open(fake)
    await ready()
    await user.click(
      within(group(t.hoursQuestion)).getByRole('radio', {
        name: he.onboardingSchedule.hours(5),
      }),
    )
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
    await user.click(screen.getByRole('switch', { name: t.hobbyLabel }))
    fireEvent.change(screen.getByLabelText(t.hobbyStart), {
      target: { value: '19:30' },
    })
    await user.click(
      within(group(t.hobbyMinutes)).getByRole('radio', {
        name: he.settings.duration(45),
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
    expect(screen.getByRole('switch', { name: t.hobbyLabel })).toBeChecked()
    expect(screen.getByLabelText(t.hobbyStart)).toHaveValue('18:00')
    await user.click(
      within(group(t.hobbyMinutes)).getByRole('radio', {
        name: he.settings.duration(90),
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
    fireEvent.change(screen.getByLabelText(t.sleepTime), {
      target: { value: '08:00' },
    })
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
    await user.click(screen.getByRole('checkbox', { name: /בוקר/ }))
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
    fireEvent.change(screen.getByLabelText(t.wakeTime), {
      target: { value: '07:00' },
    })
    await user.click(saveButton())
    const sleep = screen.getByLabelText(t.sleepTime)
    await waitFor(() => {
      expect(sleep).toHaveAccessibleDescription(t.sameTimes)
    })
  })

  it('another failure shows its message', async () => {
    const user = userEvent.setup()
    const fake = server().on('PATCH /me', problem(503, 'database_unavailable'))
    open(fake)
    await ready()
    await user.click(
      within(group(t.hoursQuestion)).getByRole('radio', {
        name: he.onboardingSchedule.hours(5),
      }),
    )
    await user.click(saveButton())
    expect(await screen.findByText(codeText('database_unavailable'))).toBeInTheDocument()
  })
})

describe('SettingsPage other sections', () => {
  it('hosts the reminder settings of S16', async () => {
    open(server())
    await ready()
    // Without a VAPID key in the test env, the card says reminders are not set up here.
    const section = screen.getByRole('region', { name: he.notifications.deviceTitle })
    expect(within(section).getByText(he.notifications.notConfigured)).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: he.settings.export.button }))
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
    await user.click(screen.getByRole('button', { name: he.settings.export.button }))
    expect(await screen.findByText(codeText('database_unavailable'))).toBeInTheDocument()
  })

  it('the danger zone links to the account deletion page', async () => {
    const user = userEvent.setup()
    const { router } = open(server())
    await ready()
    await user.click(screen.getByRole('link', { name: he.settings.danger.link }))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings/delete-account')
    })
  })
})
