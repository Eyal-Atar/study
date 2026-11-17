// What every component in ui/ shares: joining classes, and the focus ring.

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// The visible focus of the design language (section 8): a 2px brand ring with a 2px gap, only for
// keyboard focus. React Aria components set data-focus-visible; a plain element (a router link)
// has only the :focus-visible pseudo-class.
export const FOCUS_RING =
  'outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[focus-visible]:ring-offset-2'
export const FOCUS_RING_NATIVE = 'outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2'

// Every lucide icon in the app is drawn with this stroke (section 5.7).
export const ICON_STROKE = 1.75

// The look of a button, shared by Button (React Aria: data-hovered, data-pressed, data-disabled)
// and ButtonLink (a router link: :hover, :active). Design language 5.3.
export const BUTTON_BASE =
  'inline-flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-control border px-4 text-small font-semibold transition-colors duration-(--duration-fast)'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

// The colours of each variant at rest. Hover and press are added by the component, in its own
// way of marking them.
export const BUTTON_REST: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-brand text-on-brand',
  secondary: 'border-line-strong bg-surface text-ink',
  quiet: 'border-transparent text-brand',
  danger: 'border-line-strong bg-surface text-danger',
}

// The look of a button that is only an icon (IconButton, and the slotted buttons of the
// DatePicker, which keep React Aria's own Hebrew labels and so cannot be an IconButton).
// A disabled one gets the muted fill, like a disabled Button: its colour alone would not change.
export const ICON_BUTTON_CLASS = `inline-flex size-touch shrink-0 cursor-pointer items-center justify-center rounded-control border border-transparent text-ink-muted transition-colors duration-(--duration-fast) ${FOCUS_RING} data-[hovered]:bg-surface-muted data-[hovered]:text-ink data-[pressed]:bg-surface-muted data-[disabled]:cursor-not-allowed data-[disabled]:bg-surface-muted`
