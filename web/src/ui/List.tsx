import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from './styles'

export interface ListProps {
  children: ReactNode
  'aria-label'?: string
  className?: string
}

// Items of the same kind (blocks, exams, tasks) are rows with a line between them, on the
// background of the page, without a box around each (design language 5.2).
// role="list" is explicit: Safari drops the list role of a <ul> without bullets.
export function List({ children, className, 'aria-label': label }: ListProps) {
  return (
    <ul role="list" aria-label={label} className={className}>
      {children}
    </ul>
  )
}

export interface ListRowProps {
  // A fixed column at the start, like the start hour of a block.
  leading?: ReactNode
  title: ReactNode
  // Details under the title: "הסתברות, תרגול. שעה".
  subtitle?: ReactNode
  // A control at the end: the check button, or a menu. More than one action goes into a menu.
  trailing?: ReactNode
  // Makes the whole row a link to this path.
  to?: string
  // A finished task: muted, normal weight, struck through. The row stays in its place.
  done?: boolean
}

// A row of at least 64px. With `to`, the title is a link stretched over the whole row (its ::after
// covers the <li>), so the row has one link with a short name instead of a link that wraps
// everything, and a control in `trailing` sits above it and is pressed separately.
export function ListRow({ leading, title, subtitle, trailing, to, done = false }: ListRowProps) {
  const titleClass = cx('text-body break-words', done ? 'font-normal text-ink-muted line-through' : 'font-semibold text-ink')
  return (
    <li
      className={cx(
        'flex min-h-16 items-center gap-3 border-b border-line py-2',
        to !== undefined && 'relative transition-colors duration-(--duration-fast) hover:bg-surface-muted',
      )}
    >
      {leading === undefined ? null : <div className="shrink-0 text-body font-semibold tabular-nums">{leading}</div>}
      {/* min-w-0 lets a long title without spaces wrap instead of widening the page. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {to === undefined ? (
          <div className={titleClass}>{title}</div>
        ) : (
          // The focus ring is drawn on the ::after, so it goes around the row and not the words.
          <Link
            to={to}
            className={cx(
              titleClass,
              'outline-none after:absolute after:inset-0 after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-brand',
            )}
          >
            {title}
          </Link>
        )}
        {subtitle === undefined ? null : <div className="text-small break-words text-ink-muted">{subtitle}</div>}
      </div>
      {trailing === undefined ? null : <div className="relative z-10 shrink-0">{trailing}</div>}
    </li>
  )
}
