import { Check } from 'lucide-react'
import { he } from '../i18n/he'

// The mark and the name, as in the prototype (.logo): a 30px square with soft corners, a diagonal
// gradient from brand to brand-accent, and a white check. The mark is decoration: the name is the
// text. The same at both widths.
export function Logo() {
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-linear-135 from-brand to-brand-accent text-on-brand"
      >
        <Check size={18} strokeWidth={3} />
      </span>
      <span className="truncate text-[1.125rem] font-bold">{he.appName}</span>
    </span>
  )
}
