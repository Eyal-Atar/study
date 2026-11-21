import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TextField } from './TextField'

describe('TextField', () => {
  it('is a textbox named by its visible label, and typing reports every change', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextField label="Exam name" onChange={onChange} />)

    const input = screen.getByRole('textbox', { name: 'Exam name' })
    await user.type(input, 'אב')
    expect(onChange.mock.calls).toEqual([['א'], ['אב']])
    expect(input).toHaveValue('אב')
  })

  it('shows its focus: the brand border and ring hang on data-focused, and the text is 16px', async () => {
    const user = userEvent.setup()
    render(<TextField label="Name" />)

    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).not.toHaveAttribute('data-focused')
    await user.tab()
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('data-focused', 'true')
    expect(input).toHaveAttribute('data-focus-visible', 'true')
    expect(input.className).toContain('data-[focused]:border-brand')
    expect(input.className).toContain('data-[focused]:ring-2')
    expect(input.className).toContain('data-[focused]:ring-brand')
    // 16px, or iOS zooms the page on focus.
    expect(input.className).toContain('text-body')
    expect(input.className).toContain('min-h-touch')
  })

  it('links its description to the field', () => {
    render(<TextField label="minutes" description="Between 15 and 240" />)

    expect(screen.getByRole('textbox', { name: 'minutes' })).toHaveAccessibleDescription('Between 15 and 240')
  })

  it('an error message makes the field invalid and is linked to it', () => {
    render(<TextField label="minutes" errorMessage="Enter a number" />)

    const input = screen.getByRole('textbox', { name: 'minutes' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('data-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Enter a number')
    expect(input.className).toContain('data-[invalid]:border-danger')
    expect(screen.getByText('Enter a number').className).toContain('text-danger')
  })

  it('is valid without an error message', () => {
    render(<TextField label="minutes" />)

    expect(screen.getByRole('textbox', { name: 'minutes' })).not.toHaveAttribute('aria-invalid')
  })

  it('a disabled field stays readable: muted fill and text, no opacity', () => {
    render(<TextField label="Name" isDisabled value="חדו״א" />)

    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toBeDisabled()
    expect(input.className).toContain('data-[disabled]:bg-surface-muted')
    expect(input.className).toContain('data-[disabled]:text-ink-muted')
    expect(input.className).not.toContain('opacity')
  })
})
