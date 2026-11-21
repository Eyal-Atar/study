import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { WeekdayPicker } from './WeekdayPicker'

function Harness({ initial = [], errorMessage, onChange }: { initial?: string[]; errorMessage?: string; onChange?: (v: string[]) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <WeekdayPicker
      label="Which days?"
      value={value}
      errorMessage={errorMessage}
      onChange={(next) => {
        onChange?.(next)
        setValue(next)
      }}
    />
  )
}

describe('WeekdayPicker', () => {
  it('shows the short names, says the full names, in the order Sunday to Saturday', () => {
    render(<Harness />)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual([...en.commitments.weekdayLong])
    expect(screen.getByRole('group', { name: 'Which days?' })).toHaveTextContent(en.commitments.weekdayShort.join(''))
  })

  it('toggles days and reports the chosen values', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial={['1']} onChange={onChange} />)
    expect(screen.getByRole('checkbox', { name: 'Monday' })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Wednesday' }))
    expect(onChange).toHaveBeenLastCalledWith(['1', '3'])
    await user.click(screen.getByRole('checkbox', { name: 'Monday' }))
    expect(onChange).toHaveBeenLastCalledWith(['3'])
  })

  it('every box is at least 44px high and wide, and the seven fit a 360px screen', () => {
    render(<Harness />)
    for (const box of screen.getAllByRole('checkbox')) {
      const label = box.closest('label')
      expect(label?.className).toContain('min-h-touch')
      expect(label?.className).toContain('min-w-touch')
    }
    // 7 x 44px plus the gaps of the grid stay inside 360px minus the 16px gutters.
    expect(screen.getByRole('group').querySelector('.grid')?.className).toContain('gap-0.5')
  })

  it('shows its error and is invalid', () => {
    render(<Harness errorMessage="Pick at least one day." />)
    expect(screen.getByText('Pick at least one day.')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Which days?' })).toHaveAttribute('data-invalid', 'true')
  })
})
