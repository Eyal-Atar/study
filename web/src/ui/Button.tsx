import { LoaderCircle } from './icons'
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  composeRenderProps,
} from 'react-aria-components'
import { BUTTON_BASE, BUTTON_REST, cx, FOCUS_RING, FOCUS_RING_INVERSE, ICON_STROKE, type ButtonVariant } from './styles'

export interface ButtonProps extends AriaButtonProps {
  // primary: the one action the screen exists for, at most one per screen or card.
  // secondary: any other action. quiet: an action inside text. danger: cannot be undone.
  // inverse: the action of the dark toast ("Undo").
  variant?: ButtonVariant
}

// React Aria sets data-hovered, data-pressed, data-focus-visible, data-disabled and data-pending on
// the element, and the look hangs only on those (design language 5.3).
const BASE = cx(BUTTON_BASE, 'data-[disabled]:cursor-not-allowed data-[pending]:cursor-progress')

// A disabled button is muted and never transparent: opacity made "Save" unreadable on soft
// backgrounds. ink-muted on surface-muted is a checked text pair (theme.test.ts).
const DISABLED = 'data-[disabled]:border-line data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: cx(BUTTON_REST.primary, FOCUS_RING, 'data-[hovered]:bg-brand-strong data-[pressed]:bg-brand-strong', DISABLED),
  // The soft hover of the prototype: the surface-muted fill, the line stays.
  secondary: cx(BUTTON_REST.secondary, FOCUS_RING, 'data-[hovered]:bg-surface-muted data-[pressed]:bg-surface-muted', DISABLED),
  // No fill of its own, so none when disabled either. On the soft fill of its hover the text is
  // brand-strong, the stronger of the two on brand-soft.
  quiet: cx(
    BUTTON_REST.quiet,
    FOCUS_RING,
    'data-[hovered]:bg-brand-soft data-[hovered]:text-brand-strong data-[pressed]:bg-brand-soft data-[pressed]:text-brand-strong data-[disabled]:text-ink-muted',
  ),
  danger: cx(BUTTON_REST.danger, FOCUS_RING, 'data-[hovered]:bg-danger-soft data-[pressed]:bg-danger-soft', DISABLED),
  // On the dark of the toast: inverse-action text (a checked pair on inverse), turning white under
  // the pointer, since no fill of the scale reads on the dark. Disabled is line-strong, still
  // readable on the dark, and never transparent. The ring is the light one of the dark.
  inverse: cx(
    BUTTON_REST.inverse,
    FOCUS_RING_INVERSE,
    'data-[hovered]:text-on-inverse data-[pressed]:text-on-inverse data-[disabled]:text-line-strong',
  ),
}

// isPending (React Aria): the button keeps its text and its focus, shows a spinner, and ignores
// presses, so a slow save cannot be sent twice.
export function Button({ variant = 'primary', className, children, ...props }: ButtonProps) {
  return (
    <AriaButton {...props} className={composeRenderProps(className, (custom) => cx(BASE, VARIANTS[variant], custom))}>
      {composeRenderProps(children, (content, { isPending }) => (
        <>
          {isPending ? <LoaderCircle aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="animate-spin" /> : null}
          {content}
        </>
      ))}
    </AriaButton>
  )
}
