import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { FeasibilityNote, type FeasibilityEstimate } from './FeasibilityNote'

const t = en.onboardingFlow.feasibility

const ROOMY: FeasibilityEstimate = { level: 'roomy', firstExamName: 'הסתברות', firstExamMinutes: 88 * 60 }
const TIGHT: FeasibilityEstimate = {
  level: 'tight',
  firstExamName: 'הסתברות',
  firstExamMinutes: 14 * 60,
  tightExamName: 'שפת C',
  tightExamMinutes: 6 * 60,
  tightExamCount: 3,
}
const NONE: FeasibilityEstimate = { level: 'none', firstExamName: 'הסתברות', firstExamMinutes: 0 }

// The note itself: the box with the fill, inside the live region.
function noteIn(region: HTMLElement): HTMLElement {
  const note = region.querySelector('.rounded-control')
  if (!(note instanceof HTMLElement)) throw new Error('no note')
  return note
}

describe('FeasibilityNote', () => {
  it('without an estimate the live region is there, polite and empty', () => {
    render(<FeasibilityNote estimate={null} />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()
  })

  it('roomy: the sentence about the first exam, in a neutral note, with a decorative spark', () => {
    render(<FeasibilityNote estimate={ROOMY} />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent(t.roomy(ROOMY.firstExamMinutes, ROOMY.firstExamName))
    const note = noteIn(region)
    expect(note).toHaveClass('bg-surface-muted', 'text-ink')
    expect(note).not.toHaveAttribute('role')
    const icons = note.querySelectorAll('svg')
    expect(icons).toHaveLength(1)
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true')
    expect(icons[0]).not.toHaveClass('lucide-circle-alert')
  })

  it('tight: a warning note about the exam where it gets tight', () => {
    render(<FeasibilityNote estimate={TIGHT} />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent(t.tight(6 * 60, 'שפת C', 3))
    const note = noteIn(region)
    expect(note).toHaveClass('bg-warning-soft', 'text-ink')
    const icon = note.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveClass('lucide-circle-alert', 'text-warning')
  })

  it('tight at a single exam says "before" it, with no "for each exam"', () => {
    const one: FeasibilityEstimate = { ...TIGHT, tightExamName: 'הסתברות', tightExamCount: 1 }
    render(<FeasibilityNote estimate={one} />)
    expect(screen.getByRole('status').textContent).toBe(t.tight(6 * 60, 'הסתברות', 1))
    expect(screen.getByRole('status')).not.toHaveTextContent('for each exam')
  })

  it('tight without an exam of its own falls back to the first exam, as a single exam', () => {
    render(<FeasibilityNote estimate={{ level: 'tight', firstExamName: 'הסתברות', firstExamMinutes: 5 * 60 }} />)
    expect(screen.getByRole('status')).toHaveTextContent(t.tight(5 * 60, 'הסתברות', 1))
  })

  it('none: a warning note that names the exam with no study time', () => {
    const { unmount } = render(<FeasibilityNote estimate={NONE} />)
    expect(screen.getByRole('status')).toHaveTextContent(t.none('הסתברות'))
    expect(noteIn(screen.getByRole('status'))).toHaveClass('bg-warning-soft')
    unmount()

    render(<FeasibilityNote estimate={{ ...NONE, tightExamName: 'אלגוריתמים', tightExamMinutes: 0 }} />)
    expect(screen.getByRole('status')).toHaveTextContent(t.none('אלגוריתמים'))
  })

  it('a new estimate speaks in the same region: none is added and none replaced', () => {
    const { rerender } = render(<FeasibilityNote estimate={null} />)
    const region = screen.getByRole('status')

    rerender(<FeasibilityNote estimate={ROOMY} />)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toBe(region)
    expect(region).toHaveTextContent(t.roomy(ROOMY.firstExamMinutes, ROOMY.firstExamName))

    rerender(<FeasibilityNote estimate={TIGHT} />)
    expect(screen.getByRole('status')).toBe(region)
    expect(region).toHaveTextContent(t.tight(6 * 60, 'שפת C', 3))
    expect(region.textContent).toBe(t.tight(6 * 60, 'שפת C', 3))

    rerender(<FeasibilityNote estimate={null} />)
    expect(screen.getByRole('status')).toBe(region)
    expect(region).toBeEmptyDOMElement()
  })
})
