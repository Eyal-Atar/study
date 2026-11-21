import type { ReactNode } from 'react'
import { cx } from './styles'

export interface NoteProps {
  // neutral: something to know ("No free time"). warning: something that needs attention and did
  // not fail ("Could not refresh"). There is no danger tone on purpose: content that failed to load
  // is an ErrorState, and a failed action is a toast.
  tone?: 'neutral' | 'warning' | undefined
  // Given when the note appears after an action and has to be announced. A note that is on the
  // screen from the start is ordinary content, and has no role.
  role?: 'status' | 'alert' | undefined
  // A first line in semibold. It is not a heading: a note is too small to be a part of the outline.
  title?: ReactNode | undefined
  // A quiet Button at the end of the note ("Try again"). In a warning note pass a secondary
  // Button: brand text on warning-soft is not one of the checked pairs.
  action?: ReactNode
  children: ReactNode
}

// Both texts are ink: ink-muted is not allowed on the soft fill of a state (design language 2).
const TONES = {
  neutral: 'bg-surface-muted',
  warning: 'bg-warning-soft',
} as const

// A quiet remark inside a screen, a card or a dialog (design language 5.1: a muted fill with the
// corners of a control, where a card inside a card is not allowed). It has no border, so it reads
// as a part of what holds it. For a thing that stands by itself use a Card with a tone.
// The action sits on the line of the text, and wraps under it when the note is narrow: the text
// asks for 12rem before it shares the line.
export function Note({ tone = 'neutral', role, title, action, children }: NoteProps) {
  return (
    <div
      role={role}
      className={cx('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-3 py-2 text-small text-ink', TONES[tone])}
    >
      <div className="min-w-0 flex-1 basis-48 break-words">
        {title === undefined ? null : <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  )
}
