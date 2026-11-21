import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { createFakeAuth } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'
import { examColor } from '../ui/examColor'
import { ARCHIE_SECTIONS } from './archieText'
import { devText, SECTIONS } from './devText'

// Every section of the page: devText's, and Archie's from its own file (S31, Task 8).
const ALL_SECTIONS = [...SECTIONS, ...ARCHIE_SECTIONS]

const PATH = '/dev/components'

// The region of one section, by its title.
function region(id: (typeof ALL_SECTIONS)[number]['id']) {
  const title = ALL_SECTIONS.find((section) => section.id === id)?.title ?? id
  return screen.getByRole('region', { name: title })
}

// The route is lazy, so the first look at the page waits for it. The catalogue grows with every
// component, and on a busy machine (several suites at once) importing it takes longer than the
// default second of findBy, so the wait is given room; the assertions are unchanged.
async function open() {
  const view = renderRoute(PATH, { auth: createFakeAuth(null) })
  await screen.findByRole('heading', { level: 1, name: devText.page.title }, { timeout: 4000 })
  return view
}

// The page renders every component at once (13 Archies, 39 swatches), so a test of it can pass
// 5s on a busy machine; 15s is its own budget, not a looser check.
describe('the components page (dev only)', { timeout: 15_000 }, () => {
  it('opens signed out, without a redirect to login', async () => {
    const { router } = await open()

    expect(router.state.location.pathname).toBe(PATH)
    expect(screen.queryByRole('button', { name: en.login.google })).not.toBeInTheDocument()
  })

  it('has exactly one h1', async () => {
    await open()

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('has a section with an h2 for each of the components', async () => {
    await open()

    // Not an exact number: a new component adds a section, and must not have to touch this test.
    expect(SECTIONS.length).toBeGreaterThanOrEqual(22)
    for (const section of ALL_SECTIONS) {
      const heading = screen.getByRole('heading', { level: 2, name: section.title })
      // The section is named by its heading.
      expect(screen.getByRole('region', { name: section.title })).toContainElement(heading)
    }
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(ALL_SECTIONS.length)
  })

  it('the table of contents links to every section', async () => {
    await open()

    const toc = within(screen.getByRole('navigation', { name: devText.page.toc }))
    for (const section of ALL_SECTIONS) {
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

    expect(screen.getByRole('region', { name: en.common.notifications })).toHaveTextContent(devText.toast.infoText)
  })

  // S31: the design language itself.
  describe('the exam palette', () => {
    it('has a row for each of the eight colours, with a sample block and a sample next-task card', async () => {
      await open()

      const rows = region('exam-palette').querySelectorAll('[data-exam]')
      expect(rows).toHaveLength(8)
      // The hues in the order of the all-screens mockup (S31 decision 25).
      const hues = ['זית', 'טרקוטה', 'אבן כחולה', 'שזיף', 'חרדל', 'מנטה כהה', 'ורד עתיק', 'אדמה']
      expect(devText.palette.hues).toEqual(hues)
      rows.forEach((row, n) => {
        expect(row).toHaveTextContent(hues[n] ?? '')
        const c = examColor(n)
        expect(row).toHaveAttribute('data-exam', String(n))
        expect(row).toHaveTextContent(devText.palette.exams[n] ?? '')

        // The block: the soft fill, the line border, and a start stripe and a checkbox in the
        // strong colour (currentColor); the name and the time are ink.
        const block = row.querySelector('[data-part="block"]')
        expect(block).toHaveClass(c.soft, c.line, c.text, 'border-s-current')
        const check = block?.querySelector('[data-part="check"]')
        expect(check).toHaveClass('border-current')
        for (const text of block?.querySelectorAll('[data-part="text"]') ?? []) expect(text).toHaveClass('text-ink')

        // The next task: white on the strong colour.
        expect(row.querySelector('[data-part="next"]')).toHaveClass(c.solid, 'text-on-brand')
      })
    })

    it('shows busy time beside the exams, in its own grey', async () => {
      await open()

      const busy = region('exam-palette').querySelector('[data-part="busy"]')
      expect(busy).toHaveClass('bg-busy-soft', 'border-busy-line', 'border-s-busy')
      expect(busy).toHaveTextContent(devText.palette.busyTitle)
      expect(region('exam-palette')).toHaveTextContent(devText.palette.busy)
    })
  })

  it('the colours section shows every general colour with its name', async () => {
    await open()

    const colours = region('colours')
    for (const name of ['canvas', 'surface', 'surface-muted', 'ink', 'ink-muted', 'line', 'line-strong', 'brand',
      'brand-strong', 'brand-soft', 'on-brand', 'field', 'sprout', 'clay', 'on-clay', 'sand', 'gold', 'gold-soft',
      'gold-ink', 'gold-track', 'sky-from', 'sky-to',
      'sky', 'now', 'now-text', 'danger', 'danger-soft', 'success', 'success-soft', 'warning', 'warning-soft',
      'inverse', 'on-inverse', 'inverse-action', 'inverse-success', 'inverse-danger', 'busy', 'busy-soft',
      'busy-line']) {
      expect(within(colours).getByText(name, { exact: true })).toBeInTheDocument()
      expect(colours.querySelector(`.bg-${name}`)).not.toBeNull()
    }
    // brand-accent is gone (S31 decision 18).
    expect(within(colours).queryByText('brand-accent', { exact: true })).not.toBeInTheDocument()
  })

  // The dawn sky behind Archie is a gradient: shown as one, from sky-from to sky-to, with ink on it.
  it('the colours section shows the dawn sky as its gradient', async () => {
    await open()

    const sky = region('colours').querySelector('[data-part="sky"]')
    expect(sky).toHaveClass('bg-linear-to-b', 'from-sky-from', 'to-sky-to', 'text-ink')
    expect(sky).toHaveTextContent(devText.colours.sky)
  })

  it('the typography section shows the four weights and the five sizes', async () => {
    await open()

    const type = region('typography')
    for (const weight of ['font-normal', 'font-medium', 'font-semibold', 'font-bold']) {
      expect(type.querySelector(`[data-sample="${weight}"]`)).toHaveClass(weight)
    }
    for (const size of ['text-display', 'text-title', 'text-body', 'text-small', 'text-caption']) {
      expect(type.querySelector(`[data-sample="${size}"]`)).toHaveClass(size)
    }
  })

  // Amatic SC, the display font of the logo and of Archie's big headings (S31 decision 28).
  it('the typography section shows the display font, bold and big', async () => {
    await open()

    const sample = region('typography').querySelector('[data-sample="font-display"]')
    expect(sample).toHaveClass('font-display', 'font-bold')
    expect(sample).toHaveTextContent(devText.typography.displaySample)
    expect(region('typography')).toHaveTextContent(devText.typography.display)
  })

  it('the shape section shows the corners and the shadows', async () => {
    await open()

    const shape = region('shape')
    for (const cls of ['rounded-badge', 'rounded-control', 'rounded-button', 'rounded-card', 'rounded-sheet', 'shadow-raised',
      'shadow-overlay', 'shadow-lift', 'shadow-sheet']) {
      expect(shape.querySelector(`.${cls}`)).not.toBeNull()
    }
  })

  it('the shell section shows the logo and the progress chip with fixed data', async () => {
    await open()

    const shell = within(region('shell'))
    expect(shell.getByText(en.appName)).toBeInTheDocument()
    const chip = shell.getByRole('link', { name: en.shell.progressChip(devText.shell.streak, devText.shell.level) })
    expect(chip).toHaveAttribute('href', '/progress')
    expect(shell.getByRole('button', { name: devText.shell.undo })).toBeInTheDocument()
  })

  // S31, Task 8.
  it('the Archie section shows the six moods as cards, one scene and the avatars', async () => {
    await open()

    const archie = region('archie')
    const cards = archie.querySelectorAll('[data-size="card"]')
    expect([...cards].map((card) => card.getAttribute('data-mood'))).toEqual([
      'intentions', 'eureka', 'wisdom', 'flow', 'rest', 'joy',
    ])
    expect(archie.querySelectorAll('[data-size="scene"]')).toHaveLength(1)
    expect(archie.querySelectorAll('[data-size="avatar"]').length).toBeGreaterThanOrEqual(6)
    // The scene and the avatar of flow are named; the cards are decorative beside their captions.
    expect(within(archie).getAllByRole('img', { name: en.archie.alt.flow })).toHaveLength(2)
  })
})
