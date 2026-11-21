import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARCHIE_MOODS } from '../archie/moods'
import { en } from '../i18n/en'
import { ArchiLead } from './ArchiLead'
import { RecapLine } from './RecapLine'

const QUESTION = 'What exams are we preparing for?'
const CONTEXT = 'You can change all of this later.'
const BELOW = 'They’re optional, but with them I can fit the plan to your course.'

// prefers-reduced-motion as the system answers it; every other query is false.
function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

// The place Archi stands in: the element around the illustration, which carries his entrance.
function archiPlace(container: HTMLElement): HTMLElement {
  const place = container.querySelector('[data-part="archi"]')
  if (!(place instanceof HTMLElement)) throw new Error('no place for Archi')
  return place
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ArchiLead', () => {
  it('the question is the h1 of the screen, in his handwriting', () => {
    render(<ArchiLead mood="joy" question={QUESTION} />)
    const heading = screen.getByRole('heading', { level: 1, name: QUESTION })
    expect(heading).toHaveClass('font-display', 'font-bold', 'leading-none', 'text-ink')
    expect(screen.getAllByRole('heading')).toHaveLength(1)
  })

  it.each(ARCHIE_MOODS)('Archi in the %s mood is an image named by its description, before the question', (mood) => {
    render(<ArchiLead mood={mood} question={QUESTION} />)
    const archi = screen.getByRole('img', { name: en.archie.alt[mood] })
    const heading = screen.getByRole('heading', { name: QUESTION })
    // He leads: a screen reader meets him first, and then what he asks.
    expect(archi.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(archi.closest('[data-size]')).toHaveAttribute('data-size', 'card')
    expect(archi.closest('[data-mood]')).toHaveAttribute('data-mood', mood)
  })

  it('he stands straight on the surface: nothing around him paints, frames or cuts', () => {
    const { container } = render(<ArchiLead mood="wisdom" question={QUESTION} />)
    const archi = screen.getByRole('img', { name: en.archie.alt.wisdom })
    for (let el: HTMLElement | null = archi.parentElement; el && el !== container; el = el.parentElement) {
      expect(el.className).not.toMatch(/\bbg-|\bborder\b|\bring-|\brounded|\bshadow|\boverflow-/)
    }
  })

  it('headingLevel moves the question down the outline', () => {
    const { unmount } = render(<ArchiLead mood="flow" question={QUESTION} headingLevel={2} />)
    expect(screen.getByRole('heading', { level: 2, name: QUESTION })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    unmount()
    render(<ArchiLead mood="flow" question={QUESTION} headingLevel={3} />)
    expect(screen.getByRole('heading', { level: 3, name: QUESTION })).toBeInTheDocument()
  })

  it('the context is one muted sentence under the question, beside him', () => {
    render(<ArchiLead mood="intentions" question={QUESTION} context={CONTEXT} />)
    const context = screen.getByText(CONTEXT)
    expect(context).toHaveClass('text-body', 'text-ink-muted')
    const heading = screen.getByRole('heading', { name: QUESTION })
    expect(context.parentElement).toBe(heading.parentElement)
    expect(heading.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('`below` is one paragraph under the whole row, on the line he stands on', () => {
    const { container } = render(<ArchiLead mood="wisdom" question={QUESTION} below={BELOW} />)
    const below = screen.getByText(BELOW)
    expect(below.tagName).toBe('P')
    expect(below).toHaveClass('border-t', 'border-line', 'text-ink-muted')
    // Not inside the row: it takes the full width under Archi and the question.
    expect(below).not.toBe(archiPlace(container).parentElement)
    expect(archiPlace(container).parentElement).not.toContainElement(below)
  })

  it('without context and below there is only Archi and the question', () => {
    const { container } = render(<ArchiLead mood="joy" question={QUESTION} />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })

  it('Archi fades in when motion is allowed, and only inside motion-safe', () => {
    mockReducedMotion(false)
    const { container } = render(<ArchiLead mood="joy" question={QUESTION} />)
    const place = archiPlace(container)
    expect(place).toHaveAttribute('data-entering')
    const motion = place.className.split(/\s+/).filter((name) => /transition|duration|opacity|animate|starting/.test(name))
    expect(motion.length).toBeGreaterThan(0)
    for (const name of motion) expect(name.startsWith('motion-safe:')).toBe(true)
    expect(place).toHaveClass('motion-safe:duration-200')
  })

  it('under prefers-reduced-motion there is no entrance at all: he is simply there', () => {
    mockReducedMotion(true)
    const { container } = render(<ArchiLead mood="joy" question={QUESTION} />)
    const place = archiPlace(container)
    expect(place).not.toHaveAttribute('data-entering')
    expect(place.className).not.toMatch(/transition|duration|opacity|animate|starting/)
  })

  it('the question never waits for him: the heading carries no motion in either case', () => {
    mockReducedMotion(false)
    render(<ArchiLead mood="joy" question={QUESTION} context={CONTEXT} />)
    const heading = screen.getByRole('heading', { name: QUESTION })
    for (let el: HTMLElement | null = heading; el; el = el.parentElement) {
      if (el.hasAttribute('data-part')) continue
      expect(el.className).not.toMatch(/transition|opacity|animate|starting/)
    }
  })
})

describe('RecapLine', () => {
  it('is one quiet line: a small check that is decoration, and the text muted', () => {
    const { container } = render(<RecapLine label="4 hours a day" />)
    const text = screen.getByText('4 hours a day')
    expect(text).toHaveClass('truncate', 'min-w-0')
    const line = text.closest('p')
    expect(line).toHaveClass('flex', 'items-center', 'text-small', 'text-ink-muted')
    const icon = container.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveAttribute('width', '14')
    expect(icon).toHaveClass('text-brand-strong', 'shrink-0')
    // The icon comes first, then the answer.
    expect(line?.firstElementChild).toBe(icon)
    expect(container.querySelector('[data-user-text]')).toBeNull()
  })

  it('user content is cut at its own end: the label never shrinks, the value is a UserText that truncates', () => {
    render(<RecapLine label="1 exam:" value="הסתברות" />)
    const label = screen.getByText('1 exam:')
    const value = screen.getByText('הסתברות')
    // A Hebrew name cut by an LTR line would lose its beginning; .user-text-truncate takes the
    // direction of the name, so the ellipsis lands at its logical end.
    expect(value).toHaveClass('user-text-truncate')
    expect(value).toHaveAttribute('dir', 'auto')
    expect(value).toHaveAttribute('data-user-text')
    expect(label).toHaveClass('shrink-0')
    expect(label).not.toHaveClass('truncate')
    // Both share one row that may shrink inside the line.
    expect(label.parentElement).toBe(value.parentElement)
    expect(label.parentElement).toHaveClass('flex', 'min-w-0')
    expect(label.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Only the user content is cut: nothing around it carries a second ellipsis.
    expect(value.closest('.truncate')).toBeNull()
  })

  it('a list of names is one value, so the cut falls at the end of the list', () => {
    const names = ['הסתברות', 'אלגוריתמים', 'שפת C'].join(', ')
    render(<RecapLine label="3 exams:" value={names} />)
    expect(screen.getByText(names)).toHaveClass('user-text-truncate')
    expect(screen.getByRole('paragraph')).toHaveTextContent(`3 exams: ${names}`)
  })
})
