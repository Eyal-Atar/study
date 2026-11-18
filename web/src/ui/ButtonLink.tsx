import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BUTTON_BASE, BUTTON_REST, cx, FOCUS_RING_INVERSE_NATIVE, FOCUS_RING_NATIVE, type ButtonVariant } from './styles'

export interface ButtonLinkProps {
  to: string
  variant?: ButtonVariant
  className?: string
  children: ReactNode
}

// A link has no data-hovered: the same colours as Button, on :hover and :active.
const HOVER: Record<ButtonVariant, string> = {
  primary: 'hover:bg-brand-strong active:bg-brand-strong',
  secondary: 'hover:bg-surface-muted active:bg-surface-muted',
  quiet: 'hover:bg-brand-soft hover:text-brand-strong active:bg-brand-soft active:text-brand-strong',
  danger: 'hover:bg-danger-soft active:bg-danger-soft',
  inverse: 'hover:text-on-inverse active:text-on-inverse',
}

// A move to another screen that has the weight of an action: "מחיקת חשבון" in the settings, "חזרה
// לכניסה" on the goodbye page. It is a link (role link, opens in a new tab, Enter only) that looks
// like a Button. For a link inside text use TextLink; for an action use Button.
export function ButtonLink({ to, variant = 'secondary', className, children }: ButtonLinkProps) {
  const ring = variant === 'inverse' ? FOCUS_RING_INVERSE_NATIVE : FOCUS_RING_NATIVE
  return (
    <Link to={to} className={cx(BUTTON_BASE, BUTTON_REST[variant], HOVER[variant], ring, className)}>
      {children}
    </Link>
  )
}
