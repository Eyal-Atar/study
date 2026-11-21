import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { LogOut, Settings, TeaCupIcon } from './icons'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { IconButton } from './IconButton'
import { Menu, MenuItem } from './Menu'

function setup() {
  const onSettings = vi.fn()
  const onSignOut = vi.fn()
  render(
    <Menu trigger={<Button variant="secondary">Actions</Button>}>
      <MenuItem icon={Settings} onAction={onSettings}>
        Settings
      </MenuItem>
      <MenuItem icon={LogOut} tone="danger" onAction={onSignOut}>
        Sign out
      </MenuItem>
    </Menu>,
  )
  return { onSettings, onSignOut }
}

describe('Menu', () => {
  it('is closed until its trigger is pressed, and the trigger says so', () => {
    setup()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens with Enter, moves with the arrows and runs the focused item', async () => {
    const user = userEvent.setup()
    const { onSettings, onSignOut } = setup()

    await user.tab()
    await user.keyboard('{Enter}')
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Settings', 'Sign out'])
    expect(items[0]).toHaveFocus()
    // Keyboard focus is a ring inside the item, over the quiet fill: the fill alone
    // (surface-muted on white) is too faint to find.
    expect(items[0]).toHaveAttribute('data-focus-visible', 'true')
    for (const item of items) {
      expect(item).toHaveClass(
        'data-[focused]:bg-surface-muted',
        'data-[focus-visible]:ring-2',
        'data-[focus-visible]:ring-brand',
        'data-[focus-visible]:ring-inset',
      )
    }
    // React Aria names the menu by its trigger.
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeInTheDocument()

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

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    // Opened with the pointer: no item has the keyboard ring.
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item).not.toHaveAttribute('data-focus-visible')
    }
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // React Aria restores the focus on the next frame.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Actions' })).toHaveFocus()
    })
  })

  it('an item can carry one of Archi’s icons', async () => {
    const user = userEvent.setup()
    render(
      <Menu trigger={<Button variant="secondary">Actions</Button>}>
        <MenuItem icon={TeaCupIcon}>Rest</MenuItem>
      </Menu>,
    )
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    const svg = screen.getByRole('menuitem', { name: 'Rest' }).querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('width', '18')
  })

  it('a trigger that is only an icon names the menu by its aria-label', async () => {
    const user = userEvent.setup()
    render(
      <Menu
        trigger={
          <IconButton aria-label="More actions: חדו״א 1">
            <Settings aria-hidden="true" size={18} />
          </IconButton>
        }
      >
        <MenuItem>Delete</MenuItem>
      </Menu>,
    )
    await user.click(screen.getByRole('button', { name: 'More actions: חדו״א 1' }))
    expect(screen.getByRole('menu', { name: 'More actions: חדו״א 1' })).toBeInTheDocument()
  })
})
