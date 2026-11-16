import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { codeText } from '../i18n/codes'
import { he } from '../i18n/he'
import { COMPLETED_AT, meFixture } from '../onboarding/testFixtures'
import { createFakeApi, problem, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

const t = he.settings.deleteAccount

function server() {
  return createFakeApi()
    .on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT }))
    .on('DELETE /me', { job_id: 'j9' })
}

function open(fake: FakeApi) {
  const auth = createFakeAuth(fakeSession())
  const view = renderRoute('/settings/delete-account', { auth, api: fake.api })
  // Every path the router passes through, to prove /login never shows up on the way to /goodbye.
  const visited: string[] = []
  view.router.subscribe((state) => {
    visited.push(state.location.pathname)
  })
  return { ...view, auth, visited }
}

function submit() {
  return screen.getByRole('button', { name: t.submit })
}

describe('DeleteAccountPage', () => {
  it('explains what is deleted and links to the export first', async () => {
    open(server())
    await screen.findByRole('heading', { level: 1, name: t.title })
    for (const item of t.what) expect(screen.getByText(item)).toBeInTheDocument()
    expect(screen.getByText(t.intro)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t.exportLink })).toHaveAttribute('href', '/settings#export')
  })

  it('the button stays disabled until the word is typed exactly', async () => {
    const user = userEvent.setup()
    open(server())
    const field = await screen.findByRole('textbox', { name: t.confirmLabel })
    expect(submit()).toBeDisabled()
    await user.type(field, 'מחיק')
    expect(submit()).toBeDisabled()
    await user.type(field, 'ה ')
    expect(submit()).toBeEnabled()
    await user.type(field, 'x')
    expect(submit()).toBeDisabled()
  })

  it('deletes, signs out locally and shows the goodbye page without passing through /login', async () => {
    const user = userEvent.setup()
    const fake = server()
    const { auth, router, visited } = open(fake)
    await user.type(await screen.findByRole('textbox', { name: t.confirmLabel }), t.confirmWord)
    await user.click(submit())
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: he.settings.goodbye.title,
      }),
    ).toBeInTheDocument()
    expect(fake.calls('DELETE', '/me')).toHaveLength(1)
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(router.state.location.pathname).toBe('/goodbye')
    expect(visited).not.toContain('/login')
    expect(screen.getByRole('link', { name: he.settings.goodbye.login })).toHaveAttribute('href', '/login')
  })

  it('a failed delete shows the message, keeps the user signed in and enables the button again', async () => {
    const user = userEvent.setup()
    const fake = server().on('DELETE /me', problem(503, 'database_unavailable'))
    const { auth, router } = open(fake)
    await user.type(await screen.findByRole('textbox', { name: t.confirmLabel }), t.confirmWord)
    await user.click(submit())
    expect(await screen.findByText(codeText('database_unavailable'))).toBeInTheDocument()
    expect(auth.signOut).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/settings/delete-account')
    await waitFor(() => {
      expect(submit()).toBeEnabled()
    })
  })

  it('a double press sends one request', async () => {
    const user = userEvent.setup()
    let release: (value: unknown) => void = () => undefined
    const fake = server().on('DELETE /me', () => new Promise((resolve) => (release = resolve)))
    open(fake)
    await user.type(await screen.findByRole('textbox', { name: t.confirmLabel }), t.confirmWord)
    const button = submit()
    await user.dblClick(button)
    await user.click(button)
    expect(fake.calls('DELETE', '/me')).toHaveLength(1)
    release({ job_id: 'j9' })
    await screen.findByRole('heading', {
      level: 1,
      name: he.settings.goodbye.title,
    })
  })
})

describe('GoodbyePage', () => {
  it('renders signed out', async () => {
    renderRoute('/goodbye', { auth: createFakeAuth(null) })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: he.settings.goodbye.title,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(he.settings.goodbye.body)).toBeInTheDocument()
  })
})
