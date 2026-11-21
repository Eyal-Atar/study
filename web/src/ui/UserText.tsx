import type { ElementType, ReactNode } from 'react'
import { cx } from './styles'

// User content: an exam name, a task title, a topic, a file name, an event, a note written from
// the user's materials. The product speaks English, left to right; this text is in the user's
// language, often Hebrew. Every place that shows it renders it through this one component, so the
// rule lives in one place (S39, audit section 1):
// - default: <bdi dir="auto">, inline. The text takes its own direction (a Hebrew name with a
//   number or brackets reads in the right order) and is isolated, so it never reorders the
//   English around it. It stays on the line's start edge, like the rest of the interface.
// - truncate: a block that cuts a long title with an ellipsis at the END of the text (in an LTR
//   block a cut Hebrew title would lose its beginning). Still on the interface's edge.
// - prose: a paragraph of the user's content (a task's reason, a topic's evidence). A paragraph
//   reads from its own side, so it is aligned by its own direction.
// In a plain string (an aria-label, a toast) use isolate() from i18n/bidi.ts.
export function UserText({
  children,
  as,
  truncate = false,
  prose = false,
  className,
  id,
}: {
  children: ReactNode
  as?: ElementType
  truncate?: boolean
  prose?: boolean
  className?: string
  id?: string
}) {
  const Tag: ElementType = as ?? (truncate || prose ? 'span' : 'bdi')
  return (
    <Tag
      id={id}
      dir="auto"
      data-user-text=""
      className={cx(truncate && 'user-text-truncate', prose && 'block text-start', className)}
    >
      {children}
    </Tag>
  )
}
