import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { OptionGrid } from './OptionGrid'

const NAME = 'שעה פנויה'
const OPTIONS = [
  { id: '09:00', label: '09:00' },
  { id: '09:30', label: '09:30' },
  { id: '10:00', label: '10:00' },
  { id: '15:30', label: '15:30' },
] as const

// The grid is controlled, so the keyboard test needs an owner of the value.
function Owner({ onChange }: { onChange: (value: string | null) => void }) {
  const [value, setValue] = useState<string | null>(null)
  return (
    <OptionGrid
      aria-label={NAME}
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

describe('OptionGrid', () => {
  it('is a named listbox with an option for each choice, none selected while the value is null', () => {
    render(<OptionGrid aria-label={NAME} options={OPTIONS} value={null} onChange={vi.fn()} />)
    const listbox = screen.getByRole('listbox', { name: NAME })
    const options = within(listbox).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['09:00', '09:30', '10:00', '15:30'])
    for (const option of options) {
      expect(option).toHaveAttribute('aria-selected', 'false')
      expect(option.querySelector('svg')).toBeNull()
    }
  })

  it('is a grid of three columns (four from sm) that scrolls inside a bounded height', () => {
    render(<OptionGrid aria-label={NAME} options={OPTIONS} value={null} onChange={vi.fn()} />)
    const listbox = screen.getByRole('listbox', { name: NAME })
    expect(listbox).toHaveClass('grid', 'grid-cols-3', 'sm:grid-cols-4', 'gap-2', 'overflow-y-auto')
    expect(listbox.className).toMatch(/\bmax-h-/)
  })

  it('an option is a 44px lined box with tabular numbers and the focus ring', () => {
    render(<OptionGrid aria-label={NAME} options={OPTIONS} value={null} onChange={vi.fn()} />)
    const option = screen.getByRole('option', { name: '09:30' })
    expect(option).toHaveClass('min-h-touch', 'rounded-control', 'border', 'border-line', 'bg-field')
    expect(option).toHaveClass('text-small', 'font-medium', 'tabular-nums', 'text-ink')
    expect(option).toHaveClass('outline-none', 'data-[focus-visible]:ring-2', 'data-[focus-visible]:ring-brand')
    expect(option.className).not.toMatch(/shadow|opacity/)
  })

  it('the selected option is aria-selected, filled with brand, and marked with a check (not only colour)', () => {
    render(<OptionGrid aria-label={NAME} options={OPTIONS} value="10:00" onChange={vi.fn()} />)
    const selected = screen.getByRole('option', { name: '10:00' })
    expect(selected).toHaveAttribute('aria-selected', 'true')
    expect(selected).toHaveClass('border-brand', 'bg-brand', 'text-on-brand')
    expect(selected).not.toHaveClass('border-line', 'bg-field', 'text-ink')
    expect(selected.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')

    const other = screen.getByRole('option', { name: '09:00' })
    expect(other).toHaveAttribute('aria-selected', 'false')
    expect(other).not.toHaveClass('bg-brand')
  })

  it('a click asks for the id of the option, and shows only what it is given', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<OptionGrid aria-label={NAME} options={OPTIONS} value={null} onChange={onChange} />)

    await user.click(screen.getByRole('option', { name: '15:30' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('15:30')
    // Controlled: the owner has not changed the value.
    expect(screen.getByRole('option', { name: '15:30' })).toHaveAttribute('aria-selected', 'false')
  })

  it('a click on another option replaces the choice, and a click on the selected one asks for null', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<OptionGrid aria-label={NAME} options={OPTIONS} value="09:00" onChange={onChange} />)

    await user.click(screen.getByRole('option', { name: '09:30' }))
    expect(onChange).toHaveBeenLastCalledWith('09:30')

    await user.click(screen.getByRole('option', { name: '09:00' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('is one Tab stop; the arrows move between the options, and Space or Enter selects', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Owner onChange={onChange} />)

    await user.tab()
    const first = screen.getByRole('option', { name: '09:00' })
    expect(first).toHaveFocus()
    expect(first).toHaveAttribute('data-focus-visible', 'true')
    // Focus alone does not select: a time is chosen on purpose.
    expect(onChange).not.toHaveBeenCalled()

    await user.keyboard('{ArrowRight}')
    expect(first).not.toHaveFocus()
    expect(screen.getByRole('listbox', { name: NAME })).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledTimes(1)
    const chosen = onChange.mock.calls[0]?.[0] as string
    expect(screen.getByRole('option', { name: chosen })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: chosen })).toHaveFocus()
  })

  it('the option under the pointer takes the quiet fill only while it is not selected', async () => {
    const user = userEvent.setup()
    render(<OptionGrid aria-label={NAME} options={OPTIONS} value="10:00" onChange={vi.fn()} />)

    const other = screen.getByRole('option', { name: '09:00' })
    await user.hover(other)
    expect(other).toHaveClass('bg-surface-muted', 'border-line')
    expect(other).not.toHaveClass('bg-field')

    const selected = screen.getByRole('option', { name: '10:00' })
    await user.hover(selected)
    expect(selected).toHaveClass('bg-brand')
    expect(selected).not.toHaveClass('bg-surface-muted')
  })

  it('with ltr the label is inside dir="ltr", so a time or a range does not flip', () => {
    const { rerender } = render(<OptionGrid aria-label={NAME} options={OPTIONS} value={null} onChange={vi.fn()} ltr />)
    expect(screen.getByText('09:00')).toHaveAttribute('dir', 'ltr')

    rerender(<OptionGrid aria-label={NAME} options={OPTIONS} value={null} onChange={vi.fn()} />)
    expect(screen.getByText('09:00')).not.toHaveAttribute('dir')
  })
})
