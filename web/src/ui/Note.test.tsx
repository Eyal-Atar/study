import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'
import { Note } from './Note'

const TEXT = 'Could not refresh the plan.'

// The note itself: the box with the fill, around the text.
function noteOf(text: string): HTMLElement {
  const note = screen.getByText(text).closest('.rounded-control')
  if (!(note instanceof HTMLElement)) throw new Error('no note')
  return note
}

describe('Note', () => {
  it('shows its children in a quiet fill, without a role, a border or a shadow', () => {
    render(<Note>{TEXT}</Note>)
    const note = noteOf(TEXT)
    expect(note).toHaveClass('rounded-control', 'px-3', 'py-2', 'text-small', 'text-ink', 'bg-surface-muted')
    expect(note).not.toHaveAttribute('role')
    expect(note.className).not.toMatch(/shadow|opacity|border/)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('a warning note has the soft warning fill, and its text stays ink', () => {
    render(<Note tone="warning">{TEXT}</Note>)
    const note = noteOf(TEXT)
    expect(note).toHaveClass('bg-warning-soft', 'text-ink')
    expect(note).not.toHaveClass('bg-surface-muted')
    expect(note.className).not.toMatch(/text-ink-muted|text-warning/)
  })

  it.each(['status', 'alert'] as const)('passes role="%s" through, so the note is announced', (role) => {
    render(<Note role={role}>{TEXT}</Note>)
    expect(screen.getByRole(role)).toBe(noteOf(TEXT))
    expect(screen.getByRole(role)).toHaveTextContent(TEXT)
  })

  it('the title is a first line in semibold, before the children, and it is not a heading', () => {
    render(<Note title="No free time">You can pick another day.</Note>)
    const title = screen.getByText('No free time')
    expect(title).toHaveClass('font-semibold')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    const body = screen.getByText('You can pick another day.')
    expect(title.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(noteOf('No free time')).toBe(noteOf('You can pick another day.'))
  })

  it('the action sits inside the note, after the text, on a line that wraps', () => {
    render(
      <Note role="status" action={<Button variant="quiet">Try again</Button>}>
        {TEXT}
      </Note>,
    )
    const note = screen.getByRole('status')
    const button = screen.getByRole('button', { name: 'Try again' })
    expect(note).toContainElement(button)
    expect(note).toHaveClass('flex', 'flex-wrap', 'items-center')
    expect(screen.getByText(TEXT).compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a long word without spaces breaks instead of widening the note', () => {
    const long = 'א'.repeat(120)
    render(<Note>{long}</Note>)
    const text = screen.getByText(long)
    expect(text.closest('.min-w-0')).not.toBeNull()
    expect(text.closest('.break-words')).not.toBeNull()
  })
})
