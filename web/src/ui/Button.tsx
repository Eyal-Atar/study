import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  composeRenderProps,
} from 'react-aria-components'

export interface ButtonProps extends AriaButtonProps {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
}

// React Aria sets data-hovered, data-pressed, data-focus-visible and data-disabled on the element.
// min-h-11: a 44px touch target on phones.
const BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium outline-none transition-colors data-[focus-visible]:ring-2 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-brand data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'

const VARIANTS = {
  primary: 'bg-brand text-on-brand data-[hovered]:bg-brand-strong data-[pressed]:bg-brand-strong',
  secondary: 'border border-line bg-surface text-ink data-[hovered]:bg-surface-muted data-[pressed]:bg-surface-muted',
  quiet: 'text-brand data-[hovered]:bg-brand-soft data-[pressed]:bg-brand-soft',
  danger: 'border border-line bg-surface text-danger data-[hovered]:bg-danger-soft data-[pressed]:bg-danger-soft',
} as const

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={composeRenderProps(className, (custom) => [BASE, VARIANTS[variant], custom].filter(Boolean).join(' '))}
    />
  )
}
