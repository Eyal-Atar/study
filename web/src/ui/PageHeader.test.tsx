import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { PageHeader } from './PageHeader'

beforeEach(() => {
  document.title = ''
})

describe('PageHeader', () => {
  it('renders the title as the h1 of the screen, focusable from code only', () => {
    render(<PageHeader title="שבוע" />)

    const heading = screen.getByRole('heading', { level: 1, name: 'שבוע' })
    expect(heading).toHaveAttribute('tabindex', '-1')
    // The big title of the prototype: the display size in bold (700).
    expect(heading).toHaveClass('text-display', 'font-bold')
    // The shell owns the banner: a screen title is not one.
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
  })

  it('renders the subtitle and the action', () => {
    render(<PageHeader title="מבחנים" subtitle="שלושה מבחנים" action={<button type="button">הוספה</button>} />)

    expect(screen.getByText('שלושה מבחנים')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'הוספה' })).toBeInTheDocument()
  })

  it('without a subtitle or an action renders only the title', () => {
    const { container } = render(<PageHeader title="היום" />)

    expect(container.querySelectorAll('p')).toHaveLength(0)
    expect(container.textContent).toBe('היום')
  })

  it('names the browser tab after the screen, and follows a change of the title', () => {
    const { rerender } = render(<PageHeader title="שבוע" />)
    expect(document.title).toBe(`שבוע · ${en.appName}`)

    rerender(<PageHeader title="מבחנים" />)
    expect(document.title).toBe(`מבחנים · ${en.appName}`)
  })

  it('a very long title without spaces breaks instead of widening the page', () => {
    const long = 'א'.repeat(200)
    render(<PageHeader title={long} action={<button type="button">הוספה</button>} />)

    const heading = screen.getByRole('heading', { level: 1, name: long })
    expect(heading).toHaveClass('break-words')
    // The block that holds the title may shrink below its content inside the flex row.
    expect(heading.parentElement).toHaveClass('min-w-0')
  })
})
