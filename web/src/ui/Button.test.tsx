import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Settings } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { IconButton } from './IconButton'

describe('Button', () => {
  it('is a button with its text as the name, and presses with the keyboard', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(<Button onPress={onPress}>שמירה</Button>)

    await user.tab()
    const button = screen.getByRole('button', { name: 'שמירה' })
    expect(button).toHaveFocus()
    // React Aria marks keyboard focus, and the ring hangs on that mark.
    expect(button).toHaveAttribute('data-focus-visible')
    expect(button.className).toContain('data-[focus-visible]:ring-2')
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onPress).toHaveBeenCalledTimes(2)
  })

  it.each(['primary', 'secondary', 'quiet', 'danger'] as const)('a disabled %s button stays readable: muted colours, no opacity', (variant) => {
    render(
      <Button variant={variant} isDisabled>
        שמירה
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'שמירה' })
    expect(button).toBeDisabled()
    expect(button.className).not.toMatch(/opacity/)
    expect(button.className).toContain('data-[disabled]:text-ink-muted')
  })

  it('a pending button keeps its text, shows a spinner and does not press', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(
      <Button isPending onPress={onPress}>
        שמירה
      </Button>,
    )
    const button = screen.getByRole('button', { name: /שמירה/ })
    expect(button).toHaveAttribute('data-pending')
    expect(button.querySelector('svg')).not.toBeNull()

    await user.click(button)
    button.focus()
    await user.keyboard('{Enter}')
    expect(onPress).not.toHaveBeenCalled()
  })
})

describe('Button variant inverse', () => {
  it('is the action of the dark toast: light green text, no border, and a light ring on the dark', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(
      <Button variant="inverse" onPress={onPress}>
        בטל
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'בטל' })
    const classes = button.className.split(' ')
    expect(classes).toContain('text-inverse-action')
    expect(classes).toContain('border-transparent')
    // One focus colour only: the brand ring of the other variants would be faint on the dark.
    expect(classes).toContain('data-[focus-visible]:ring-inverse-action')
    expect(classes).toContain('data-[focus-visible]:ring-offset-inverse')
    expect(classes).not.toContain('data-[focus-visible]:ring-brand')
    expect(classes).not.toContain('text-brand')
    await user.tab()
    expect(button).toHaveAttribute('data-focus-visible')
    await user.keyboard('{Enter}')
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('a disabled inverse button is muted, never transparent', () => {
    render(
      <Button variant="inverse" isDisabled>
        בטל
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'בטל' })
    expect(button).toBeDisabled()
    expect(button.className).not.toMatch(/opacity/)
    expect(button.className).toContain('data-[disabled]:text-line-strong')
  })
})

describe('IconButton', () => {
  it('is a 44px button named by its aria-label, with the icon hidden from screen readers', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(
      <IconButton aria-label="הגדרות" onPress={onPress}>
        <Settings aria-hidden="true" size={18} />
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: 'הגדרות' })
    expect(button.className).toContain('size-touch')
    await user.click(button)
    expect(onPress).toHaveBeenCalledOnce()
  })
})

describe('IconButton variants', () => {
  it('secondary carries one border colour and one text colour, not the quiet ones too', () => {
    render(
      <IconButton aria-label="עוד" variant="secondary">
        <Settings aria-hidden="true" size={18} />
      </IconButton>,
    )
    const classes = screen.getByRole('button', { name: 'עוד' }).className.split(' ')
    // The border of a secondary Button (the "היום" of the prototype): the icon, not the line,
    // is what makes it a button.
    expect(classes).toContain('border-line')
    expect(classes).not.toContain('border-transparent')
    expect(classes).toContain('text-ink')
    expect(classes).not.toContain('text-ink-muted')
  })

  it('inverse is white on the dark toast, with one ring colour, and stays pressable', async () => {
    const user = userEvent.setup()
    const onPress = vi.fn()
    render(
      <IconButton aria-label="סגירה" variant="inverse" onPress={onPress}>
        <Settings aria-hidden="true" size={18} />
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: 'סגירה' })
    const classes = button.className.split(' ')
    expect(classes).toContain('text-on-inverse')
    expect(classes).toContain('border-transparent')
    expect(classes).toContain('size-touch')
    expect(classes).not.toContain('text-ink-muted')
    expect(classes).toContain('data-[focus-visible]:ring-inverse-action')
    expect(classes).not.toContain('data-[focus-visible]:ring-brand')
    await user.click(button)
    expect(onPress).toHaveBeenCalledOnce()
  })
})

describe('Button look', () => {
  it('a secondary button has the quiet line of the prototype, and every label is medium', () => {
    render(<Button variant="secondary">היום</Button>)
    const classes = screen.getByRole('button', { name: 'היום' }).className.split(' ')
    expect(classes).toContain('border-line')
    expect(classes).not.toContain('border-line-strong')
    // The 14px corners of the mockup's .btn (S31 decision 27); 12px is the corner of a field.
    expect(classes).toContain('rounded-button')
    expect(classes).not.toContain('rounded-control')
    expect(classes).toContain('font-medium')
    expect(classes).not.toContain('font-semibold')
  })
})

describe('ButtonLink', () => {
  it('is a link with the look of a button, reachable with Tab', async () => {
    const { MemoryRouter } = await import('react-router')
    const { ButtonLink } = await import('./ButtonLink')
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ButtonLink to="/settings/delete-account" variant="danger">
          מחיקת חשבון
        </ButtonLink>
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'מחיקת חשבון' })
    expect(link).toHaveAttribute('href', '/settings/delete-account')
    expect(link.className).toContain('min-h-touch')
    expect(link.className).toContain('text-danger')
    expect(link.className).toContain('focus-visible:ring-2')
    await user.tab()
    expect(link).toHaveFocus()
  })

  it('inverse: the light action of the dark toast, with the ring of the dark and no other', async () => {
    const { MemoryRouter } = await import('react-router')
    const { ButtonLink } = await import('./ButtonLink')
    render(
      <MemoryRouter>
        <ButtonLink to="/calendar" variant="inverse">
          לפתוח
        </ButtonLink>
      </MemoryRouter>,
    )
    const classes = screen.getByRole('link', { name: 'לפתוח' }).className.split(' ')
    expect(classes).toContain('text-inverse-action')
    expect(classes).toContain('border-transparent')
    expect(classes).toContain('hover:text-on-inverse')
    expect(classes).toContain('rounded-button')
    expect(classes).toContain('focus-visible:ring-inverse-action')
    expect(classes).toContain('focus-visible:ring-offset-inverse')
    expect(classes).not.toContain('focus-visible:ring-brand')
    expect(classes).not.toContain('text-ink')
  })
})
