import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { COMPLETED_AT, examFixture, jobFixture, meFixture } from '../onboarding/testFixtures'
import { createFakeApi, problem, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

function server(completedAt: string | null) {
  return createFakeApi()
    .on('GET /me', meFixture({ onboarding_completed_at: completedAt }))
    .on('GET /exams', [examFixture()])
    .on('GET /exams/e1/materials', [])
    .on({ method: 'GET', path: /^\/jobs\// }, jobFixture({ stage: 'analyzing', percent: 30 }))
}

function open(fake: FakeApi, path: string) {
  return renderRoute(path, { auth: createFakeAuth(fakeSession()), api: fake.api })
}

const JOB_KEY = 'studyflow:onboarding-job:user-a'

beforeEach(() => {
  sessionStorage.clear()
})

describe('OnboardingGate', () => {
  it('sends a user without a plan whose job still runs to the building screen of that job', async () => {
    sessionStorage.setItem(JOB_KEY, 'j7')
    const fake = server(null)
    const { router } = open(fake, '/')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/building')
    })
    expect(router.state.location.search).toBe('?job=j7')
    expect(await screen.findByRole('progressbar')).toBeInTheDocument()
    expect(fake.calls('POST', '/plans/generate')).toHaveLength(0)
  })

  it('/onboarding with a remembered job goes to that job', async () => {
    sessionStorage.setItem(JOB_KEY, 'j7')
    const { router } = open(server(null), '/onboarding')
    await waitFor(() => {
      expect(router.state.location.search).toBe('?job=j7')
    })
  })

  it('a job remembered for another user is not followed', async () => {
    sessionStorage.setItem('studyflow:onboarding-job:user-b', 'j7')
    const { router } = open(server(null), '/')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/exams')
    })
  })

  it('a step the user opened stays, also with a remembered job', async () => {
    sessionStorage.setItem(JOB_KEY, 'j7')
    const { router } = open(server(null), '/onboarding/exams')
    await screen.findByRole('heading', { level: 1 })
    expect(router.state.location.pathname).toBe('/onboarding/exams')
  })

  it('sends a user without a plan from /today to the onboarding', async () => {
    const { router } = open(server(null), '/today')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/exams')
    })
  })

  it('sends a user without a plan from / to the first step', async () => {
    const { router } = open(server(null), '/')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/exams')
    })
  })

  it('/onboarding goes to the first step', async () => {
    const { router } = open(server(null), '/onboarding')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/onboarding/exams')
    })
  })

  it('keeps a user without a plan on the step in the URL', async () => {
    const { router } = open(server(null), '/onboarding/schedule')
    await screen.findByRole('heading', { level: 1 })
    expect(router.state.location.pathname).toBe('/onboarding/schedule')
  })

  it('sends a user with a plan from the onboarding to /calendar', async () => {
    const { router } = open(server(COMPLETED_AT), '/onboarding/materials')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
    expect(await screen.findByRole('heading', { name: en.today.title })).toBeInTheDocument()
  })

  it('lets a user with a plan see the building screen of a job (its summary)', async () => {
    const { router } = open(server(COMPLETED_AT), '/onboarding/building?job=j1')
    expect(await screen.findByRole('progressbar')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/onboarding/building')
  })

  it('sends a user with a plan from the building screen without a job to /calendar', async () => {
    const { router } = open(server(COMPLETED_AT), '/onboarding/building')
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/calendar')
    })
  })

  it('shows loading while /me is pending', async () => {
    const fake = createFakeApi().on('GET /me', () => new Promise(() => undefined))
    const { router } = open(fake, '/today')
    // The shell is up (the auth check passed), and the gate holds the screen.
    expect(await screen.findByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(en.common.loading)
    expect(router.state.location.pathname).toBe('/today')
  })

  it('a failed /me shows the error and retries on demand', async () => {
    const user = userEvent.setup()
    let fail = true
    const fake = createFakeApi()
      .on('GET /me', () => (fail ? problem(503, 'database_unavailable') : meFixture({ onboarding_completed_at: COMPLETED_AT })))
    const { router } = open(fake, '/today')

    expect(await screen.findByRole('alert')).toHaveTextContent(codeText('database_unavailable'))
    fail = false
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    expect(await screen.findByRole('heading', { name: en.today.title })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/calendar')
  })
})
