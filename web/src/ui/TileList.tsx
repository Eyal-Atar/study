import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { cx } from './styles'

export interface TileListProps {
  'aria-label': string
  children: ReactNode
  className?: string | undefined
}

// A list that sits right on the canvas of the page (S34 decision 8): the exams, the fixed hours.
// ListRow is a soft tile for a list inside a surface, and on the canvas it is swallowed; a TileRow
// is the .card of the all-screens mockup, a white tile with a quiet line. The tiles space
// themselves (8px), like the rows of a List.
// role="list" is explicit: Safari drops the list role of a <ul> without bullets.
export function TileList({ 'aria-label': label, children, className }: TileListProps) {
  return (
    <ul role="list" aria-label={label} className={className}>
      {children}
    </ul>
  )
}

export interface TileRowProps {
  // A fixed column at the start: the initial of an exam, an icon.
  leading?: ReactNode
  title: ReactNode
  // Details under the title: "10 בדצמבר, 42% מהתוכנית".
  subtitle?: ReactNode
  // What sits at the end, in one line: a chip, a menu. It is pressed separately from the tile.
  trailing?: ReactNode
  // A line under the title across the whole text column: the progress bar of an exam.
  footer?: ReactNode
  // Makes the whole tile a link to this path.
  to?: string | undefined
  // Makes the whole tile a button, for a tile that opens a dialog. With both, `to` wins.
  onPress?: (() => void) | undefined
}

// The title of a pressable tile is stretched over it: its ::after covers the <li>, and the focus
// ring is drawn on it with the corners of the tile, so it goes around the tile and not the words.
const STRETCHED =
  'outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:ring-2 focus-visible:after:ring-brand focus-visible:after:ring-offset-2'

// The .card of the mockup: the surface, a line, the 18px of a card, 12px inside; 8px to the next.
const TILE = 'flex min-h-16 items-center gap-3 rounded-card border border-line bg-surface p-3 mt-2 first:mt-0'

const TITLE = 'text-body font-semibold break-words text-ink'

// One tile, with the structure of ListRow: with `to` or `onPress` the title is the one control of
// the tile, with a short name, and a control in `trailing` sits above it.
export function TileRow({ leading, title, subtitle, trailing, footer, to, onPress }: TileRowProps) {
  const isPressable = to !== undefined || onPress !== undefined
  return (
    <li className={cx(TILE, isPressable && 'relative transition-colors duration-(--duration-fast) hover:bg-surface-muted')}>
      {leading === undefined ? null : <div className="shrink-0">{leading}</div>}
      {/* min-w-0 lets a long title without spaces wrap instead of widening the page. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {to !== undefined ? (
          <Link to={to} className={cx(TITLE, STRETCHED)}>
            {title}
          </Link>
        ) : onPress !== undefined ? (
          // A plain <button>, like the one of ListRow: its states hang on pseudo-classes, like the
          // link. text-start: a button centres its text.
          <button type="button" onClick={onPress} className={cx(TITLE, STRETCHED, 'cursor-pointer text-start')}>
            {title}
          </button>
        ) : (
          <div className={TITLE}>{title}</div>
        )}
        {subtitle === undefined ? null : <div className="text-small break-words text-ink-muted">{subtitle}</div>}
        {footer === undefined ? null : <div className="mt-1">{footer}</div>}
      </div>
      {trailing === undefined ? null : (
        <div className="relative z-10 flex max-w-[50%] min-w-0 shrink-0 items-center gap-2">{trailing}</div>
      )}
    </li>
  )
}
