import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { he } from '../i18n/he'
import { createFakeAuth } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import { devText, SECTIONS } from './devText'

const PATH = '/dev/components'

// The route is lazy, so the first look at the page waits for it.
async function open() {
  const view = renderRoute(PATH, { auth: createFakeAuth(null) })
  await screen.findByRole('heading', { level: 1, name: devText.page.title })
  return view
}

describe('the components page (dev only)', () => {
  it('opens signed out, without a redirect to login', async () => {
    const { router } = await open()

    expect(router.state.location.pathname).toBe(PATH)
    expect(screen.queryByRole('button', { name: he.login.google })).not.toBeInTheDocument()
  })

  it('has exactly one h1', async () => {
    await open()

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('has a section with an h2 for each of the components', async () => {
    await open()

    // Not an exact number: a new component adds a section, and must not have to touch this test.
    expect(SECTIONS.length).toBeGreaterThanOrEqual(22)
    for (const section of SECTIONS) {
      const heading = screen.getByRole('heading', { level: 2, name: section.title })
      // The section is named by its heading.
      expect(screen.getByRole('region', { name: section.title })).toContainElement(heading)
    }
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(SECTIONS.length)
  })

  it('the table of contents links to every section', async () => {
    await open()

    const toc = within(screen.getByRole('navigation', { name: devText.page.toc }))
    for (const section of SECTIONS) {
      expect(toc.getByRole('link', { name: section.title })).toHaveAttribute('href', `#${section.id}`)
      expect(document.getElementById(section.id)).not.toBeNull()
    }
  })

  it.each(['button', 'textbox', 'radiogroup', 'progressbar', 'list', 'status', 'alert'])(
    'contains at least one %s',
    async (role) => {
      await open()

      expect(screen.getAllByRole(role).length).toBeGreaterThan(0)
    },
  )

  it('the open-dialog button shows a dialog', async () => {
    const user = userEvent.setup()
    await open()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: devText.dialog.open }))

    expect(await screen.findByRole('dialog', { name: devText.dialog.title })).toBeInTheDocument()
  })

  it('the open-alert button shows an alertdialog', async () => {
    const user = userEvent.setup()
    await open()

    await user.click(screen.getByRole('button', { name: devText.dialog.openAlert }))

    expect(await screen.findByRole('alertdialog', { name: devText.dialog.alertTitle })).toBeInTheDocument()
  })

  it('the info-toast button shows the text in the notifications region', async () => {
    const user = userEvent.setup()
    await open()

    await user.click(screen.getByRole('button', { name: devText.toast.showInfo }))

    expect(screen.getByRole('region', { name: he.common.notifications })).toHaveTextContent(devText.toast.infoText)
  })
})
