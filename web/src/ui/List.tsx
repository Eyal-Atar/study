import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from './styles'

export interface ListProps {
  children: ReactNode
  'aria-label'?: string
  className?: string
}

// Items of the same kind (blocks, exams, tasks) are rows (design language 5.2). The list adds no
// layout of its own: the rows space themselves, so a caller's className (a line above, a margin)
// never fights a gap of the list.
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
  // Details under the title: "Probability, practice. 1 h".
  subtitle?: ReactNode
  // What sits at the end, in one line: a badge, the check button, a menu. More than one extra
  // action goes into a menu. It gets at most half of the row, and a badge in it is cut to fit.
  trailing?: ReactNode
  // Makes the whole row a link to this path.
  to?: string | undefined
  // Makes the whole row a button, for a row that opens a dialog and not a screen. A row is one or
  // the other: with both, `to` wins.
  onPress?: (() => void) | undefined
  // A finished task: muted, normal weight, struck through. The row stays in its place.
  done?: boolean
}

// The title of a row that is a link or a button is stretched over the whole row: its ::after
// covers the <li>, and the focus ring is drawn on it, so it goes around the row and not the words.
const STRETCHED = 'outline-none after:absolute after:inset-0 after:rounded-[12px] focus-visible:after:ring-2 focus-visible:after:ring-brand'

// The .task of the prototype: a soft tile in the canvas colour with 12px corners, 6px from the next
// one, and no line between them. The radius is the prototype's own, between a control (10px) and a
// card (16px), so it is written here as it is. It reads as a tile on a white surface (a card, a
// panel); on the canvas of the page it is the spacing that separates the rows.
const ROW = 'flex min-h-16 items-center gap-3 rounded-[12px] bg-canvas px-2.5 py-2 mt-1.5 first:mt-0'

// A row of at least 64px. With `to` (a link) or `onPress` (a button), the title is that link or
// button, stretched over the whole row, so the row has one control with a short name instead of
// one that wraps everything, and a control in `trailing` sits above it and is pressed separately.
export function ListRow({ leading, title, subtitle, trailing, to, onPress, done = false }: ListRowProps) {
  const titleClass = cx('text-body break-words', done ? 'font-normal text-ink-muted line-through' : 'font-semibold text-ink')
  const isPressable = to !== undefined || onPress !== undefined
  return (
    <li
      className={cx(ROW, isPressable && 'relative transition-colors duration-(--duration-fast) hover:bg-surface-muted')}
    >
      {leading === undefined ? null : <div className="shrink-0 text-body font-semibold tabular-nums">{leading}</div>}
      {/* min-w-0 lets a long title without spaces wrap instead of widening the page. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {to !== undefined ? (
          <Link to={to} className={cx(titleClass, STRETCHED)}>
            {title}
          </Link>
        ) : onPress !== undefined ? (
          // A plain <button>: its states (hover on the row, the ring on the ::after) are drawn
          // with pseudo-classes, exactly like the link. text-start: a button centres its text.
          <button type="button" onClick={onPress} className={cx(titleClass, STRETCHED, 'cursor-pointer text-start')}>
            {title}
          </button>
        ) : (
          <div className={titleClass}>{title}</div>
        )}
        {subtitle === undefined ? null : <div className="text-small break-words text-ink-muted">{subtitle}</div>}
      </div>
      {/* max-w-[50%] with min-w-0: a long badge is cut here instead of squeezing the title out. */}
      {trailing === undefined ? null : (
        <div className="relative z-10 flex max-w-[50%] min-w-0 shrink-0 items-center gap-2">{trailing}</div>
      )}
    </li>
  )
}
