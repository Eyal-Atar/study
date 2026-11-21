import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { isolate } from '../i18n/bidi'
import { PageHeader } from './PageHeader'

beforeEach(() => {
  document.title = ''
})

describe('PageHeader', () => {
  it('renders the title as the h1 of the screen, focusable from code only', () => {
    render(<PageHeader title="Week" />)

    const heading = screen.getByRole('heading', { level: 1, name: 'Week' })
    expect(heading).toHaveAttribute('tabindex', '-1')
    // The big title of the prototype: the display size in bold (700).
    expect(heading).toHaveClass('text-display', 'font-bold')
    // The shell owns the banner: a screen title is not one.
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
  })

  it('renders the subtitle and the action', () => {
    render(<PageHeader title="Exams" subtitle="Three exams" action={<button type="button">Add</button>} />)

    expect(screen.getByText('Three exams')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('without a subtitle or an action renders only the title', () => {
    const { container } = render(<PageHeader title="Today" />)

    expect(container.querySelectorAll('p')).toHaveLength(0)
    expect(container.textContent).toBe('Today')
  })

  it('names the browser tab after the screen, and follows a change of the title', () => {
    const { rerender } = render(<PageHeader title="Week" />)
    expect(document.title).toBe(`Week – ${en.appName}`)

    rerender(<PageHeader title="Exams" />)
    expect(document.title).toBe(`Exams – ${en.appName}`)
  })

  it('a very long title without spaces breaks instead of widening the page', () => {
    const long = 'א'.repeat(200)
    render(<PageHeader title={long} action={<button type="button">Add</button>} />)

    const heading = screen.getByRole('heading', { level: 1, name: long })
    expect(heading).toHaveClass('break-words')
    // The block that holds the title may shrink below its content inside the flex row.
    expect(heading.parentElement).toHaveClass('min-w-0')
  })

  it('with userTitle the h1 holds the title in a dir="auto" element, and the tab title isolates it', () => {
    render(<PageHeader title="הסתברות" userTitle />)

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.querySelector('bdi[dir="auto"]')).toHaveTextContent('הסתברות')
    expect(document.title).toBe(`${isolate('הסתברות')} – ${en.appName}`)
  })

  it('without userTitle the title carries no dir attribute', () => {
    render(<PageHeader title="הסתברות" />)

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.querySelector('[dir]')).toBeNull()
    expect(heading).not.toHaveAttribute('dir')
  })
})
