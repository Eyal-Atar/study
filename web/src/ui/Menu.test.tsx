import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { LogOut, Settings } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { Menu, MenuItem } from './Menu'

function setup() {
  const onSettings = vi.fn()
  const onSignOut = vi.fn()
  render(
    <Menu trigger={<Button variant="secondary">פעולות</Button>}>
      <MenuItem icon={Settings} onAction={onSettings}>
        הגדרות
      </MenuItem>
      <MenuItem icon={LogOut} tone="danger" onAction={onSignOut}>
        יציאה
      </MenuItem>
    </Menu>,
  )
  return { onSettings, onSignOut }
}

describe('Menu', () => {
  it('is closed until its trigger is pressed, and the trigger says so', () => {
    setup()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'פעולות' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens with Enter, moves with the arrows and runs the focused item', async () => {
    const user = userEvent.setup()
    const { onSettings, onSignOut } = setup()

    await user.tab()
    await user.keyboard('{Enter}')
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['הגדרות', 'יציאה'])
    expect(items[0]).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onSignOut).toHaveBeenCalledOnce()
    expect(onSettings).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Escape closes it and gives the focus back to the trigger', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: 'פעולות' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // React Aria restores the focus on the next frame.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'פעולות' })).toHaveFocus()
    })
  })
})
