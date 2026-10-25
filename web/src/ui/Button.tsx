import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  composeRenderProps,
} from 'react-aria-components'

export interface ButtonProps extends AriaButtonProps {
  variant?: 'primary' | 'secondary'
}

// React Aria sets data-hovered, data-pressed, data-focus-visible and data-disabled on the element.
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium outline-none transition-colors data-[focus-visible]:ring-2 data-[focus-visible]:ring-offset-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50'

const VARIANTS = {
  primary:
    'bg-slate-900 text-white data-[hovered]:bg-slate-700 data-[pressed]:bg-slate-800 data-[focus-visible]:ring-slate-900',
  secondary:
    'border border-slate-300 bg-white text-slate-900 data-[hovered]:bg-slate-100 data-[pressed]:bg-slate-200 data-[focus-visible]:ring-slate-500',
} as const

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={composeRenderProps(className, (custom) =>
        [BASE, VARIANTS[variant], custom].filter(Boolean).join(' '),
      )}
    />
  )
}
