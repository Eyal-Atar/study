import { onlineManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { meKey } from '../api/me'
import { createQueryClient } from './queryClient'
import { en } from '../i18n/en'
import { COMPLETED_AT, examFixture, jobFixture, meFixture, previewFixture } from '../test/onboardingFixtures'
import { createFakeApi, type ApiCall } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import { SNAPSHOT_KEY } from '../offline/snapshot'

const ZONE = 'Pacific/Auckland'

// The browser reports ZONE; every other part of resolvedOptions stays real.
function browserIn(zone: string) {
  // Called below with the right `this`.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const real = Intl.DateTimeFormat.prototype.resolvedOptions
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...real.call(this), timeZone: zone }
  })
}

function server({ completedAt, planAffected }: { completedAt: string | null; planAffected: boolean }) {
  const me = meFixture({ timezone: 'Asia/Jerusalem', onboarding_completed_at: completedAt })
  return createFakeApi()
    .on('GET /me', me)
    .on('PATCH /me', (call: ApiCall) => ({ ...me, ...(call.body as object), plan_affected: planAffected }))
    .on('GET /exams', [examFixture()])
    .on({ method: 'GET', path: /^\/jobs\// }, jobFixture())
    .on('POST /plan/replan', previewFixture())
}

const open = (fake: ReturnType<typeof server>, path: string) =>
  renderRoute(path, { auth: createFakeAuth(fakeSession()), api: fake.api })

afterEach(() => {
  onlineManager.setOnline(true)
  window.localStorage.clear()
})

describe('TimezoneSync', () => {
  it('a browser in another zone sends PATCH /me {timezone} once, and a user with a plan gets the replan offer', async () => {
    const user = userEvent.setup()
    browserIn(ZONE)
    const fake = server({ completedAt: COMPLETED_AT, planAffected: true })
    open(fake, '/today')

    expect(await screen.findByText(en.replan.timezoneChanged)).toBeInTheDocument()
    expect(fake.calls('PATCH', '/me')).toEqual([{ method: 'PATCH', path: '/me', body: { timezone: ZONE } }])

    await user.click(screen.getByRole('button', { name: en.replan.showChange }))
    const dialog = await screen.findByRole('dialog', { name: en.replan.title })
    expect(within(dialog).getByText(en.replan.timezoneReason)).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/replan')).toHaveLength(1)
    })
    // The profile now has the browser's zone: no second PATCH.
    expect(fake.calls('PATCH', '/me')).toHaveLength(1)
  })

  it('during the onboarding the PATCH is sent, but no replan is offered', async () => {
    browserIn(ZONE)
    const fake = server({ completedAt: null, planAffected: true })
    open(fake, '/onboarding/building?job=j1')

    await waitFor(() => {
      expect(fake.calls('PATCH', '/me')).toHaveLength(1)
    })
    await screen.findByRole('progressbar')
    // Let the PATCH answer arrive.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText(en.replan.timezoneChanged)).not.toBeInTheDocument()
  })

  it('no offer when the plan is not affected', async () => {
    browserIn(ZONE)
    const fake = server({ completedAt: COMPLETED_AT, planAffected: false })
    open(fake, '/today')

    await waitFor(() => {
      expect(fake.calls('PATCH', '/me')).toHaveLength(1)
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText(en.replan.timezoneChanged)).not.toBeInTheDocument()
  })

  it('the same zone sends nothing', async () => {
    browserIn('Asia/Jerusalem')
    const fake = server({ completedAt: COMPLETED_AT, planAffected: true })
    open(fake, '/today')

    expect(await screen.findByRole('heading', { name: en.today.title })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fake.calls('PATCH', '/me')).toHaveLength(0)
  })

  it('without a network sends nothing, and sends the one PATCH once the network is back (S38)', async () => {
    browserIn(ZONE)
    const fake = server({ completedAt: COMPLETED_AT, planAffected: false })
    // The app's client: its writes run with networkMode 'always' (they would fail, not wait).
    const queryClient = createQueryClient()
    // The profile as the device snapshot holds it, and its owner, so the session keeps the cache.
    queryClient.setQueryData(meKey('user-a'), meFixture({ timezone: 'Asia/Jerusalem', onboarding_completed_at: COMPLETED_AT }))
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ version: 1, userId: 'user-a', state: { mutations: [], queries: [] } }))
    onlineManager.setOnline(false)
    renderRoute('/today', { auth: createFakeAuth(fakeSession()), api: fake.api, queryClient })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fake.calls('PATCH', '/me')).toHaveLength(0)

    act(() => {
      onlineManager.setOnline(true)
    })
    await waitFor(() => {
      expect(fake.calls('PATCH', '/me')).toEqual([{ method: 'PATCH', path: '/me', body: { timezone: ZONE } }])
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fake.calls('PATCH', '/me')).toHaveLength(1)
  })
})
