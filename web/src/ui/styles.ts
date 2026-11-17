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
