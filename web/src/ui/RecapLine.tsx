import type { ReactNode } from 'react'
import { CheckMarkIcon } from './icons'

// An earlier answer of the conversation, kept as one quiet line under Archi ("3 exams: ..."): a
// small check and muted text, cut at the end when it is long. It is not a control and not a
// heading. User content inside it goes through <UserText>, or isolate() when it is one string.
// The line brings no space around it: the screen that stacks it decides.
export function RecapLine({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-small text-ink-muted">
      {/* The green of the prototype's --brand-ink, which is brand-strong here. */}
      <CheckMarkIcon size={14} strokeWidth={2.25} className="shrink-0 text-brand-strong" />
      <span className="min-w-0 truncate">{children}</span>
    </p>
  )
}
