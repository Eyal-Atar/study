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
