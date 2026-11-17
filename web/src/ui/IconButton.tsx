import { Button as AriaButton, type ButtonProps as AriaButtonProps, composeRenderProps } from 'react-aria-components'
import { cx, ICON_BUTTON_BASE, ICON_BUTTON_CLASS } from './styles'

export interface IconButtonProps extends AriaButtonProps {
  // An icon says nothing to a screen reader: the name is required.
  'aria-label': string
  variant?: 'quiet' | 'secondary'
}

// secondary: the border and surface of a secondary Button. Disabled: muted, like a Button.
const SECONDARY = cx(
  ICON_BUTTON_BASE,
  'border-line-strong bg-surface text-ink data-[hovered]:bg-surface-muted data-[pressed]:bg-surface-muted',
  'data-[disabled]:border-line data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted',
)

// A button that is only an icon: a 44px square. The child is a lucide icon of 18px with
// aria-hidden; the drawing may be small, the touch target is not.
export function IconButton({ variant = 'quiet', className, ...props }: IconButtonProps) {
  return (
    <AriaButton
      {...props}
      className={composeRenderProps(className, (custom) => cx(variant === 'secondary' ? SECONDARY : ICON_BUTTON_CLASS, custom))}
    />
  )
}
