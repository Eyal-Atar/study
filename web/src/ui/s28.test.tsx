import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CollapsibleSection } from './CollapsibleSection'
import { CompactSelect } from './CompactSelect'
import { Switch } from './Switch'

describe('Switch', () => {
  function Demo({ onChange, isDisabled }: { onChange: (on: boolean) => void; isDisabled?: boolean }) {
    const [on, setOn] = useState(false)
    return (
      <Switch
        label="זמן לעצמי כל יום"
        description="זמן קבוע ביום שבו לא נשבץ לימוד."
        isSelected={on}
        onChange={(next) => {
          setOn(next)
          onChange(next)
        }}
        isDisabled={isDisabled}
      />
    )
  }

  it('is a switch named by its label and described by its description', () => {
    render(<Demo onChange={vi.fn()} />)
    const control = screen.getByRole('switch', { name: 'זמן לעצמי כל יום' })
    expect(control).not.toBeChecked()
    expect(control).toHaveAccessibleDescription('זמן קבוע ביום שבו לא נשבץ לימוד.')
  })

  it('toggles with a click and with Space, and reports the new state', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Demo onChange={onChange} />)
    const control = screen.getByRole('switch')
    await user.click(control)
    expect(control).toBeChecked()
    expect(onChange).toHaveBeenLastCalledWith(true)
    await user.keyboard(' ')
    expect(control).not.toBeChecked()
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('shows the keyboard focus on the track, and is a 44px row without a shadow', async () => {
    const user = userEvent.setup()
    const { container } = render(<Demo onChange={vi.fn()} />)
    await user.tab()
    expect(screen.getByRole('switch')).toHaveFocus()
    const row = container.querySelector('label')
    expect(row).toHaveClass('min-h-touch')
    expect(row?.querySelector('[aria-hidden="true"]')).toHaveClass('ring-2', 'ring-brand')
    expect(container.innerHTML).not.toMatch(/shadow|opacity/)
  })

  it('does not change while disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Demo onChange={onChange} isDisabled />)
    await user.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('switch')).toBeDisabled()
  })
})

describe('CompactSelect', () => {
  const OPTIONS = [
    { value: 'syllabus', label: 'סילבוס' },
    { value: 'past_exam', label: 'מבחן עבר' },
  ]

  it('is a button named by aria-label and the value, with no visible label', () => {
    render(<CompactSelect aria-label="סוג הקובץ a.pdf" value="syllabus" options={OPTIONS} onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /סוג הקובץ a\.pdf/ })
    expect(trigger).toHaveTextContent('סילבוס')
    expect(trigger).toHaveClass('min-h-touch')
    expect(screen.queryByText('סוג הקובץ a.pdf')).toBeNull()
  })

  it('opens with the keyboard and reports the chosen value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<CompactSelect aria-label="סוג הקובץ a.pdf" value="syllabus" options={OPTIONS} onChange={onChange} />)
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('option', { name: 'סילבוס' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('option', { name: 'מבחן עבר' }))
    expect(onChange).toHaveBeenCalledWith('past_exam')
  })

  it('does not open while disabled, and is muted, not transparent', async () => {
    const user = userEvent.setup()
    render(<CompactSelect aria-label="סוג" value="syllabus" options={OPTIONS} onChange={vi.fn()} isDisabled />)
    const trigger = screen.getByRole('button')
    await user.click(trigger)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger.className).toContain('data-[disabled]:bg-surface-muted')
    expect(trigger.className).not.toMatch(/opacity/)
  })
})

describe('CollapsibleSection', () => {
  function Demo({ start = false }: { start?: boolean }) {
    const [open, setOpen] = useState(start)
    return (
      <CollapsibleSection title="חומרים" summary="3 קבצים" isExpanded={open} onExpandedChange={setOpen}>
        <p>סילבוס</p>
      </CollapsibleSection>
    )
  }

  it('is an h2 whose button says whether the section is open, with the summary beside it', () => {
    render(<Demo />)
    const heading = screen.getByRole('heading', { level: 2, name: /חומרים/ })
    const trigger = screen.getByRole('button', { name: /חומרים/ })
    expect(heading).toContainElement(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('3 קבצים')
    // Closed, the content is in the DOM and not visible.
    expect(screen.getByText('סילבוס')).not.toBeVisible()
  })

  it('opens and closes with the keyboard', async () => {
    const user = userEvent.setup()
    render(<Demo />)
    await user.tab()
    const trigger = screen.getByRole('button', { name: /חומרים/ })
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('סילבוס')).toBeVisible()
    await user.keyboard(' ')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows its content when the caller opens it', () => {
    render(<Demo start />)
    expect(screen.getByText('סילבוס')).toBeVisible()
  })
})
