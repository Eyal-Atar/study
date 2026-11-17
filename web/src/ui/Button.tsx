import { LoaderCircle } from 'lucide-react'
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  composeRenderProps,
} from 'react-aria-components'
import { cx, FOCUS_RING, ICON_STROKE } from './styles'

export interface ButtonProps extends AriaButtonProps {
  // primary: the one action the screen exists for, at most one per screen or card.
  // secondary: any other action. quiet: an action inside text or a toast. danger: cannot be undone.
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
}

// React Aria sets data-hovered, data-pressed, data-focus-visible, data-disabled and data-pending on
// the element, and the look hangs only on those (design language 5.3).
const BASE = cx(
  'inline-flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-control border px-4 text-small font-semibold',
  'transition-colors duration-(--duration-fast)',
  FOCUS_RING,
  'data-[disabled]:cursor-not-allowed data-[pending]:cursor-progress',
)

// A disabled button is muted and never transparent: opacity made "שמירה" unreadable on soft
// backgrounds. ink-muted on surface-muted is a checked text pair (theme.test.ts).
const DISABLED = 'data-[disabled]:border-line data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted'

const VARIANTS = {
  primary: cx('border-transparent bg-brand text-on-brand data-[hovered]:bg-brand-strong data-[pressed]:bg-brand-strong', DISABLED),
  secondary: cx('border-line-strong bg-surface text-ink data-[hovered]:bg-surface-muted data-[pressed]:bg-surface-muted', DISABLED),
  // No fill of its own, so none when disabled either.
  quiet: 'border-transparent text-brand data-[hovered]:bg-brand-soft data-[pressed]:bg-brand-soft data-[disabled]:text-ink-muted',
  danger: cx('border-line-strong bg-surface text-danger data-[hovered]:bg-danger-soft data-[pressed]:bg-danger-soft', DISABLED),
} as const

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
