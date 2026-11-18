// What every component in ui/ shares: joining classes, the focus ring, and the look of a button.
// The look is the one of the calendar prototype (S31, docs/design/prototype/calendar-prototype.html):
// soft corners, quiet lines, medium labels and semibold names.

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// The visible focus of the design language (section 8): a 2px brand ring with a 2px gap, only for
// keyboard focus. React Aria components set data-focus-visible; a plain element (a router link)
// has only the :focus-visible pseudo-class.
export const FOCUS_RING =
  'outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[focus-visible]:ring-offset-2'
export const FOCUS_RING_NATIVE = 'outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2'

// The same ring on the dark of the toast (bg-inverse): brand is faint on it, so the ring is the
// light indigo of its action, and the gap is the dark itself instead of white. A control takes one
// of the two rings, never both: two ring colours on one element are settled by the order of the
// stylesheet, not of the class list.
export const FOCUS_RING_INVERSE =
  'outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-inverse-action data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-offset-inverse'
export const FOCUS_RING_INVERSE_NATIVE =
  'outline-none focus-visible:ring-2 focus-visible:ring-inverse-action focus-visible:ring-offset-2 focus-visible:ring-offset-inverse'

// Every lucide icon in the app is drawn with this stroke (section 5.7).
export const ICON_STROKE = 1.75

// The look of a button, shared by Button (React Aria: data-hovered, data-pressed, data-disabled)
// and ButtonLink (a router link: :hover, :active). Design language 5.3. The label is medium (500),
// like the "היום" and the tabs of the prototype; semibold is for names and headings.
// The focus ring is not here: each variant brings its own (the inverse one differs).
export const BUTTON_BASE =
  'inline-flex min-h-touch cursor-pointer items-center justify-center gap-2 rounded-control border px-4 text-small font-medium transition-colors duration-(--duration-fast)'

// inverse: the action on the dark toast ("בטל"), and nowhere else.
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'inverse'

// The colours of each variant at rest. Hover and press are added by the component, in its own
// way of marking them.
// secondary and danger have the quiet border-line of the prototype's "היום": a button has text, so
// its border is not what identifies it (WCAG 1.4.11 asks 3:1 only of what identifies a control).
// A field, whose border is all there is, keeps line-strong (TextField).
export const BUTTON_REST: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-brand text-on-brand',
  secondary: 'border-line bg-surface text-ink',
  quiet: 'border-transparent text-brand',
  danger: 'border-line bg-surface text-danger',
  inverse: 'border-transparent text-inverse-action',
}

// The look of a button that is only an icon (IconButton, and the slotted buttons of the
// DatePicker, which keep React Aria's own Hebrew labels and so cannot be an IconButton): a 44px
// square with the corners of a control, like the .iconbtn of the prototype.
// The shape holds no colour and no ring: two colour classes of the same property on one element
// are settled by the order of the stylesheet, not of the class list, so each variant brings all of
// its own.
export const ICON_BUTTON_SHAPE =
  'inline-flex size-touch shrink-0 cursor-pointer items-center justify-center rounded-control border transition-colors duration-(--duration-fast) data-[disabled]:cursor-not-allowed'
export const ICON_BUTTON_BASE = `${ICON_BUTTON_SHAPE} ${FOCUS_RING}`

// quiet: no border and no fill, muted until hovered (the soft surface-muted fill). A disabled one
// gets the muted fill, like a disabled Button: its colour alone would not change.
export const ICON_BUTTON_CLASS = `${ICON_BUTTON_BASE} border-transparent text-ink-muted data-[hovered]:bg-surface-muted data-[hovered]:text-ink data-[pressed]:bg-surface-muted data-[disabled]:bg-surface-muted`
