import { CheckMarkIcon } from './icons'
import { UserText } from './UserText'

export interface RecapLineProps {
  // Archi's own words, in English: "4 hours a day", or the part before the user's content
  // ("3 exams:"). With a value it never shrinks and is never cut.
  label: string
  // The user's content of the answer: one name, or a list of names joined into one string
  // (names.join(', ')). Passed as it is: no isolate() and no <UserText> around it.
  value?: string | undefined
}

// An earlier answer of the conversation, kept as one quiet line under Archi ("3 exams: ..."): a
// small check and muted text, cut at the end when it is long. It is not a control and not a
// heading. The line brings no space around it: the screen that stacks it decides.
//
// User content goes in `value`, never inside `label` (not even through isolate()): an LTR line
// that cuts a Hebrew name clips its right edge, which is where the name begins, and the reader
// would see the tail of a word as though it were the name. The value is a <UserText truncate>,
// which takes the direction of its text, so the ellipsis lands at the logical end of the name or
// of the list, and its first words stay.
export function RecapLine({ label, value }: RecapLineProps) {
  return (
    <p className="flex items-center gap-2 text-small text-ink-muted">
      {/* The green of the prototype's --brand-ink, which is brand-strong here. */}
      <CheckMarkIcon size={14} strokeWidth={2.25} className="shrink-0 text-brand-strong" />
      {value === undefined ? (
        <span className="min-w-0 truncate">{label}</span>
      ) : (
        <span className="flex min-w-0 gap-1">
          {/* The space is for whoever reads or copies the line; the gap draws it. */}
          <span className="shrink-0">
            {label}{' '}
          </span>
          <UserText truncate>{value}</UserText>
        </span>
      )}
    </p>
  )
}
