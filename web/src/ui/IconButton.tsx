import { Button as AriaButton, type ButtonProps as AriaButtonProps, composeRenderProps } from 'react-aria-components'
import { cx, FOCUS_RING_INVERSE, ICON_BUTTON_BASE, ICON_BUTTON_CLASS, ICON_BUTTON_SHAPE } from './styles'

export interface IconButtonProps extends AriaButtonProps {
  // An icon says nothing to a screen reader: the name is required.
  'aria-label': string
  // quiet (the default): the .iconbtn of the prototype. secondary: with the line of a secondary
  // Button. inverse: on the dark toast.
  variant?: 'quiet' | 'secondary' | 'inverse'
}

// secondary: the quiet border and surface of a secondary Button. Disabled: muted, like a Button.
const SECONDARY = cx(
  ICON_BUTTON_BASE,
  'border-line bg-surface text-ink data-[hovered]:bg-surface-muted data-[pressed]:bg-surface-muted',
  'data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted',
)

// inverse: white on the dark of the toast (on-inverse on inverse is a checked pair), turning the
// light indigo of the toast's action under the pointer; no fill of the scale reads on the dark.
// The ring is the light one of the dark (FOCUS_RING_INVERSE), not the brand ring of the base.
const INVERSE = cx(
  ICON_BUTTON_SHAPE,
  FOCUS_RING_INVERSE,
  'border-transparent text-on-inverse data-[hovered]:text-inverse-action data-[pressed]:text-inverse-action data-[disabled]:text-line-strong',
)

const VARIANTS = { quiet: ICON_BUTTON_CLASS, secondary: SECONDARY, inverse: INVERSE } as const

// A button that is only an icon: a 44px square. The child is a lucide icon of 18px with
// aria-hidden; the drawing may be small, the touch target is not.
export function IconButton({ variant = 'quiet', className, ...props }: IconButtonProps) {
  return <AriaButton {...props} className={composeRenderProps(className, (custom) => cx(VARIANTS[variant], custom))} />
}
