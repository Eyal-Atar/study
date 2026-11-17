import { Button as AriaButton, type ButtonProps as AriaButtonProps, composeRenderProps } from 'react-aria-components'
import { cx, FOCUS_RING } from './styles'

export interface IconButtonProps extends AriaButtonProps {
  // An icon says nothing to a screen reader: the name is required.
  'aria-label': string
  variant?: 'quiet' | 'secondary'
}

const BASE = cx(
  'inline-flex size-touch shrink-0 cursor-pointer items-center justify-center rounded-control border',
  'transition-colors duration-(--duration-fast)',
  FOCUS_RING,
  'data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-muted',
)

const VARIANTS = {
  quiet: 'border-transparent text-ink-muted data-[hovered]:bg-surface-muted data-[hovered]:text-ink data-[pressed]:bg-surface-muted',
  secondary:
    'border-line-strong bg-surface text-ink data-[hovered]:bg-surface-muted data-[pressed]:bg-surface-muted data-[disabled]:border-line data-[disabled]:bg-surface-muted',
} as const

// A button that is only an icon: a 44px square. The child is a lucide icon of 18px with
// aria-hidden; the drawing may be small, the touch target is not.
export function IconButton({ variant = 'quiet', className, ...props }: IconButtonProps) {
  return <AriaButton {...props} className={composeRenderProps(className, (custom) => cx(BASE, VARIANTS[variant], custom))} />
}
