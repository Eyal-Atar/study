import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { WeekPainter } from './WeekPainter'

const t = en.commitments.painter
const name = (day: number, hour: number) => t.cell(en.commitments.weekdayLong[day] ?? '', `${String(hour).padStart(2, '0')}:00`)
const cell = (day: number, hour: number) => screen.getByRole('button', { name: name(day, hour) })

// The painter with its state held by a parent, as the onboarding holds it.
function Harness({ initial = [], saved = [], onChange }: { initial?: string[]; saved?: string[]; onChange?: (next: Set<string>) => void }) {
  const [painted, setPainted] = useState<ReadonlySet<string>>(new Set(initial))
  return (
    <WeekPainter
      firstHour={8}
      lastHour={23}
      painted={painted}
      saved={new Set(saved)}
      onChange={(next) => {
        onChange?.(next)
        setPainted(next)
      }}
    />
  )
}

// jsdom has no layout: elementFromPoint answers from a table the test fills, keyed by clientX.
const atPoint = new Map<number, Element | null>()
let nextX = 1
function pointAt(el: Element | null): { clientX: number; clientY: number } {
  const x = nextX
  nextX += 1
  atPoint.set(x, el)
  return { clientX: x, clientY: 0 }
}

beforeEach(() => {
  atPoint.clear()
  document.elementFromPoint = vi.fn((x: number) => atPoint.get(x) ?? null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function down(el: Element, pointerType = 'mouse') {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, buttons: 1, isPrimary: true, pointerType })
}
function move(el: Element | null, pointerType = 'mouse') {
  fireEvent.pointerMove(document, { pointerId: 1, buttons: 1, pointerType, ...pointAt(el) })
}

describe('WeekPainter', () => {
  it('is a named grid: a header row of days, then one row for each hour from firstHour to lastHour', () => {
    render(<Harness />)
    const grid = screen.getByRole('grid', { name: t.label })
    const rows = within(grid).getAllByRole('row')
    expect(rows).toHaveLength(1 + 15)
    expect(within(rows[0] as HTMLElement).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', ...en.commitments.weekdayShort])
    expect(within(rows[1] as HTMLElement).getAllByRole('gridcell')).toHaveLength(7)
    expect(cell(0, 8)).toHaveAttribute('aria-pressed', 'false')
    expect(cell(6, 22)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: name(0, 23) })).toBeNull()
    expect(name(0, 10)).toBe('Sunday 10:00')
  })

  it('the hours after midnight are the bottom of the previous day, and their name is the real day', () => {
    render(<WeekPainter firstHour={8} lastHour={26} painted={new Set(['0-1'])} saved={new Set()} onChange={vi.fn()} />)
    // Sunday's column, at 01:00, is Monday 01:00 by the clock; its key is the column's: 0-1.
    expect(cell(1, 1)).toHaveAttribute('aria-pressed', 'true')
    expect(cell(1, 1)).toHaveAttribute('data-cell', '0-1')
  })

  it('a tap marks a cell, and a second tap clears it', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)
    await user.click(cell(0, 10))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect([...(onChange.mock.calls[0]?.[0] as Set<string>)]).toEqual(['0-10'])
    expect(cell(0, 10)).toHaveAttribute('aria-pressed', 'true')
    await user.click(cell(0, 10))
    expect(cell(0, 10)).toHaveAttribute('aria-pressed', 'false')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('a drag over three cells marks the three', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    down(cell(2, 14))
    move(cell(2, 15))
    move(cell(2, 15))
    move(cell(2, 16))
    fireEvent.pointerUp(document, { pointerId: 1 })
    for (const hour of [14, 15, 16]) expect(cell(2, hour)).toHaveAttribute('aria-pressed', 'true')
    expect(onChange).toHaveBeenCalledTimes(3)
    expect([...(onChange.mock.lastCall?.[0] as Set<string>)].sort()).toEqual(['2-14', '2-15', '2-16'])
  })

  it('a drag that starts on a marked cell clears, and leaves unmarked cells alone', () => {
    render(<Harness initial={['1-9', '1-10']} />)
    down(cell(1, 9))
    move(cell(1, 10))
    move(cell(1, 11))
    fireEvent.pointerUp(document, { pointerId: 1 })
    for (const hour of [9, 10, 11]) expect(cell(1, hour)).toHaveAttribute('aria-pressed', 'false')
  })

  it('a pointerup outside the grid stops the marking: a later move changes nothing', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    down(cell(3, 10))
    move(null)
    fireEvent.pointerUp(document.body, { pointerId: 1 })
    move(cell(3, 11))
    move(cell(3, 12))
    expect(cell(3, 10)).toHaveAttribute('aria-pressed', 'true')
    expect(cell(3, 11)).toHaveAttribute('aria-pressed', 'false')
    expect(cell(3, 12)).toHaveAttribute('aria-pressed', 'false')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('a pointercancel (the browser took the touch) stops the marking', () => {
    render(<Harness />)
    down(cell(4, 10), 'touch')
    move(cell(4, 11), 'touch')
    fireEvent.pointerCancel(document, { pointerId: 1, pointerType: 'touch' })
    move(cell(4, 12), 'touch')
    expect(cell(4, 11)).toHaveAttribute('aria-pressed', 'true')
    expect(cell(4, 12)).toHaveAttribute('aria-pressed', 'false')
  })

  it('a mouse move with no button held (the release was outside the window) stops the marking', () => {
    render(<Harness />)
    down(cell(5, 10))
    fireEvent.pointerMove(document, { pointerId: 1, buttons: 0, pointerType: 'mouse', ...pointAt(cell(5, 11)) })
    move(cell(5, 12))
    expect(cell(5, 11)).toHaveAttribute('aria-pressed', 'false')
    expect(cell(5, 12)).toHaveAttribute('aria-pressed', 'false')
  })

  it('a move of another pointer does not paint', () => {
    render(<Harness />)
    down(cell(5, 10))
    fireEvent.pointerMove(document, { pointerId: 2, buttons: 1, pointerType: 'touch', ...pointAt(cell(5, 11)) })
    expect(cell(5, 11)).toHaveAttribute('aria-pressed', 'false')
  })

  it('a saved cell is named saved and never changes: not by a drag through it, a tap, or the keyboard', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness saved={['0-11']} onChange={onChange} />)
    const saved = screen.getByRole('button', { name: t.cellSaved(en.commitments.weekdayLong[0], '11:00') })
    expect(saved.getAttribute('aria-label')).toBe('Sunday 11:00, saved')
    expect(saved).toHaveAttribute('aria-pressed', 'true')

    down(cell(0, 10))
    move(saved)
    move(cell(0, 12))
    fireEvent.pointerUp(document, { pointerId: 1 })
    expect(cell(0, 10)).toHaveAttribute('aria-pressed', 'true')
    expect(cell(0, 12)).toHaveAttribute('aria-pressed', 'true')
    expect([...(onChange.mock.lastCall?.[0] as Set<string>)].sort()).toEqual(['0-10', '0-12'])

    onChange.mockClear()
    await user.click(saved)
    saved.focus()
    await user.keyboard(' ')
    await user.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
    // A drag that starts on a saved cell paints nothing either.
    down(saved)
    move(cell(0, 13))
    fireEvent.pointerUp(document, { pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('one cell is in the tab order, and the arrows move the focus between cells, stopping at the edges', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const tabbable = screen.getAllByRole('button').filter((b) => b.tabIndex === 0)
    expect(tabbable).toEqual([cell(0, 8)])
    await user.tab()
    expect(cell(0, 8)).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(cell(1, 8)).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(cell(1, 10)).toHaveFocus()
    expect(cell(1, 10).tabIndex).toBe(0)
    expect(cell(0, 8).tabIndex).toBe(-1)
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(cell(0, 8)).toHaveFocus()
    await user.keyboard('{End}')
    expect(cell(6, 8)).toHaveFocus()
    await user.keyboard('{Home}')
    expect(cell(0, 8)).toHaveFocus()
  })

  it('Space and Enter mark the focused cell', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness onChange={onChange} />)
    await user.tab()
    await user.keyboard(' ')
    expect(cell(0, 8)).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(cell(0, 9)).toHaveAttribute('aria-pressed', 'true')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('a pressed cell becomes the cell in the tab order', () => {
    render(<Harness />)
    down(cell(3, 12))
    fireEvent.pointerUp(document, { pointerId: 1 })
    expect(cell(3, 12).tabIndex).toBe(0)
  })

  it('only the grid takes the touch (touch-action: none), not the page around it', () => {
    const { container } = render(<Harness />)
    expect(screen.getByRole('grid')).toHaveClass('touch-none')
    expect(container.firstElementChild).toBe(screen.getByRole('grid'))
  })

  it('the mark eases in only inside motion-safe, so reduced motion has no transition', () => {
    render(<Harness initial={['0-8']} />)
    const all = [screen.getByRole('grid'), ...screen.getByRole('grid').querySelectorAll('*')]
    const motion = all.flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => /transition|duration|ease|animate/.test(c)))
    expect(motion.length).toBeGreaterThan(0)
    for (const c of motion) expect(c.startsWith('motion-safe:')).toBe(true)
    expect(motion).toContain('motion-safe:duration-[120ms]')
  })

  it('stops listening to the document when it unmounts in the middle of a drag', () => {
    const onChange = vi.fn()
    const { unmount } = render(<Harness onChange={onChange} />)
    down(cell(0, 8))
    act(() => {
      unmount()
    })
    move(null)
    fireEvent.pointerUp(document, { pointerId: 1 })
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
