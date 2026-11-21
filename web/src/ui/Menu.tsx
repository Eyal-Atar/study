import type { IconType } from './icons'
import type { ReactElement, ReactNode } from 'react'
import {
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuTrigger,
  Popover,
  type MenuItemProps as AriaMenuItemProps,
  type PopoverProps,
} from 'react-aria-components'
import { cx, ICON_STROKE } from './styles'

export interface MenuProps {
  // The button that opens the menu: a Button or an IconButton. React Aria gives it aria-haspopup
  // and aria-expanded, returns the focus to it when the menu closes, and names the menu by it
  // (aria-labelledby), so the menu takes no aria-label of its own.
  trigger: ReactElement
  // Where the menu opens relative to the trigger. "bottom end": under it, aligned to its end side.
  placement?: PopoverProps['placement']
  children: ReactNode
}

// The extra actions of a row or of the profile (design language 5.2: actions live in a menu, not
// in a row of buttons). It floats, so it is one of the few things with a shadow.
export function Menu({ trigger, placement = 'bottom end', children }: MenuProps) {
  return (
    <MenuTrigger>
      {trigger}
      <Popover
        placement={placement}
        offset={4}
        className="min-w-44 rounded-card border border-line bg-surface p-1 shadow-overlay transition-opacity duration-(--duration-slow) data-[entering]:opacity-0 data-[exiting]:opacity-0"
      >
        <AriaMenu className="outline-none">{children}</AriaMenu>
      </Popover>
    </MenuTrigger>
  )
}

export interface MenuItemProps extends Omit<AriaMenuItemProps, 'children' | 'className'> {
  icon?: IconType
  // danger: an action that cannot be undone.
  tone?: 'default' | 'danger'
  children: ReactNode
}

// One action: 44px high. The focused item (keyboard or pointer) gets the quiet fill. Keyboard
// focus also gets the brand ring, drawn inside the item: surface-muted on white is too faint to
// be the only sign of where the keyboard is (WCAG 2.4.7), and an outer ring would be cut by the
// padding of the popover.
export function MenuItem({ icon: Icon, tone = 'default', children, ...props }: MenuItemProps) {
  return (
    <AriaMenuItem
      {...props}
      className={cx(
        'flex min-h-touch cursor-pointer items-center gap-2 rounded-control px-3 text-small outline-none data-[focused]:bg-surface-muted data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[focus-visible]:ring-inset data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-muted',
        tone === 'danger' ? 'text-danger' : 'text-ink',
      )}
    >
      {Icon === undefined ? null : <Icon aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="shrink-0" />}
      {children}
    </AriaMenuItem>
  )
}
