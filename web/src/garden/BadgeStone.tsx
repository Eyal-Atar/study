import type { JSX, ReactNode } from 'react'
import type { BadgeGroup } from '../progress/types'

/*
  The badge stones (S33, plan decision 6): one stone per group, each with its own silhouette, so the
  five tell apart with no colour at all. A symbol is cut into the stone, redrawn here on the line
  of the icon set (1.75, round caps and joins, the "paper" layer under the line), and a row of dots
  under it tells the tier within the group: filled up to the tier, open after it.

  A 48 grid with 3 units of air on every side. The stone has no colour of its own: earned is gold
  (gold-soft under a gold-ink line), not yet earned is a dashed outline on surface-muted. Both
  tokens exist in the day and in the dusk theme, so the stone follows the theme with no branch.

  Decoration only: the tile beside it says the badge in words.
*/

interface Shape {
  /** The outline of the stone; the cairn has two, the lower one first so the upper sits on it. */
  stones: string[]
  /** Facet lines inside the polished stone. */
  facets?: string[]
  /** The centre of the symbol in the 48 grid, and its scale from the 24 grid of the icons. */
  symbol: { cx: number; cy: number; scale: number }
  /** The y of the row of tier dots. */
  dotsY: number
}

const SHAPES: Record<BadgeGroup, Shape> = {
  // A low, round pebble.
  first: {
    stones: ['M7.5 30.5C7 21.5 14 15 24 15s16.75 5.5 16.5 14.5C40.25 37 33.5 41.5 24 41.5S8 38 7.5 30.5Z'],
    symbol: { cx: 24, cy: 25.5, scale: 0.62 },
    dotsY: 35.5,
  },
  // A flat, wide river stone.
  blocks: {
    stones: ['M3.5 28.5C3.5 21.5 11.5 17 24 17.5s20.75 4 20.5 11c-.25 6-9 9-21.5 8.5S3.5 34 3.5 28.5Z'],
    symbol: { cx: 24, cy: 24.75, scale: 0.5 },
    dotsY: 32.75,
  },
  // A tall, narrow standing stone.
  streak: {
    stones: ['M14.5 44C12 34 12.5 20 16 11c1.75-4.75 4.75-7.5 8.5-7.5 4.25 0 7.25 3.75 8.75 9.5 2.5 9.5 2.5 21.5.25 31-.25 1-18.75 1-19 0Z'],
    symbol: { cx: 24, cy: 19.5, scale: 0.6 },
    dotsY: 34,
  },
  // A cairn: a small stone on a wide one.
  level: {
    stones: [
      'M4.5 37C4.25 31 12 27.5 24 27.5S43.75 31 43.5 36.75C43.25 42 36 45 24 45S4.75 42.5 4.5 37Z',
      'M13.75 17.75C13.5 10 18 5 24.5 5s10.75 5 10.25 12.5C34.25 24.5 30 28.5 24 28.5s-10-4-10.25-10.75Z',
    ],
    symbol: { cx: 24, cy: 16.75, scale: 0.6 },
    dotsY: 36.5,
  },
  // A polished stone cut in facets.
  xp: {
    stones: ['M24 3.5 38 10l6 14-5.5 14L24 44.5 9.5 38 4 24l6-14Z'],
    facets: ['M10 10l7 5.5h14l7-5.5', 'M4 24l13-8.5', 'M44 24l-13-8.5'],
    symbol: { cx: 24, cy: 26, scale: 0.6 },
    dotsY: 37.5,
  },
}

// The symbols, on the 24 grid of the icon set. `paper` takes the fill class of the paper layer.
function symbolOf(group: BadgeGroup, paper: string): ReactNode {
  const PAPER = { className: paper, fillOpacity: 0.14 }
  switch (group) {
    // A sprout: two leaves on a stem (SproutIcon without its ground).
    case 'first':
      return (
        <>
          <path d="M12 14c-4.5 0-7.2-2.2-7.5-6.5 4.3 0 7.2 2.2 7.5 6.5Z" {...PAPER} />
          <path d="M12 10.5c.3-4.3 3-6.5 7.5-6.5 0 4.3-3 6.5-7.5 6.5Z" {...PAPER} />
          <path d="M12 20V10.5" />
        </>
      )
    // The mark of Done: the line of CheckMarkIcon.
    case 'blocks':
      return <path d="M4.5 12.75c2 1.5 3.5 3.25 4.75 5.5C11.75 12.5 15 8.5 19.75 5.5" />
    // The streak leaf (StreakLeafIcon).
    case 'streak':
      return (
        <>
          <path d="M7 17.5C4 11 9.5 4 20 4c0 10.5-6.5 16-13 13.5Z" {...PAPER} />
          <path d="M3.5 20.5C7 17 10.5 13.5 14.5 9.5" />
        </>
      )
    // A small tree: a round crown on a trunk with one branch, on the ground.
    case 'level':
      return (
        <>
          <path d="M12 15.5c-4 0-6.5-2.6-6.5-6 0-3.3 2.9-5.75 6.5-5.75s6.5 2.45 6.5 5.75c0 3.4-2.5 6-6.5 6Z" {...PAPER} />
          <path d="M12 20.5v-9" />
          <path d="m12 14 2.5-2.5" />
          <path d="M8.5 20.5h7" />
        </>
      )
    // The XP spark (XpSparkIcon).
    case 'xp':
      return (
        <>
          <path d="M10 5c.7 5 3 7.3 8 8-5 .7-7.3 3-8 8-.7-5-3-7.3-8-8 5-.7 7.3-3 8-8Z" {...PAPER} />
          <path
            d="M18.5 2.75c.3 1.7 1.05 2.45 2.75 2.75-1.7.3-2.45 1.05-2.75 2.75-.3-1.7-1.05-2.45-2.75-2.75 1.7-.3 2.45-1.05 2.75-2.75Z"
            strokeWidth={1.25}
          />
        </>
      )
  }
}

const LINE = 1.75
const DOT_R = 1.5
const DOT_GAP = 4.25

/** The stone alone, with no symbol and no dots: a <g> for the garden to place in its own SVG. */
export function StoneShape({ group, earned }: { group: BadgeGroup; earned: boolean }): JSX.Element {
  const shape = SHAPES[group]
  const stone = earned ? 'fill-gold-soft stroke-gold-ink' : 'fill-surface-muted stroke-line-strong'
  const dash = earned ? undefined : '3 3'
  return (
    <g strokeWidth={LINE} strokeLinecap="round" strokeLinejoin="round">
      {shape.stones.map((d) => (
        <path key={d} d={d} data-part="stone" className={stone} strokeDasharray={dash} />
      ))}
      {shape.facets?.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          strokeWidth={1}
          className={earned ? 'stroke-gold-ink' : 'stroke-line-strong'}
          strokeDasharray={dash}
        />
      ))}
    </g>
  )
}

/** A badge stone: the stone of its group, its symbol, and `tiers` dots filled up to `tier`. */
export function BadgeStone({
  group,
  tier,
  tiers,
  earned,
  size = 48,
  className,
}: {
  group: BadgeGroup
  tier: number
  tiers: number
  earned: boolean
  size?: number
  className?: string
}): JSX.Element {
  const shape = SHAPES[group]
  const { cx, cy, scale } = shape.symbol
  const ink = earned ? 'stroke-gold-ink' : 'stroke-ink-muted'
  const paper = earned ? 'fill-gold-ink' : 'fill-ink-muted'
  const firstDot = 24 - ((tiers - 1) * DOT_GAP) / 2
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      data-group={group}
      className={className}
    >
      <StoneShape group={group} earned={earned} />
      {/* The symbol keeps the 1.75 line of the 48 grid however far it is scaled. */}
      <g
        transform={`translate(${String(cx - 12 * scale)} ${String(cy - 12 * scale)}) scale(${String(scale)})`}
        fill="none"
        strokeWidth={LINE / scale}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={ink}
      >
        {symbolOf(group, paper)}
      </g>
      <g strokeWidth={1}>
        {Array.from({ length: tiers }, (_, i) => {
          const filled = i < tier
          const tone = filled
            ? earned
              ? 'fill-gold-ink stroke-gold-ink'
              : 'fill-ink-muted stroke-ink-muted'
            : earned
              ? 'stroke-gold-ink'
              : 'stroke-line-strong'
          return (
            <circle
              key={i}
              cx={firstDot + i * DOT_GAP}
              cy={shape.dotsY}
              r={DOT_R}
              fill={filled ? undefined : 'none'}
              className={tone}
              data-dot={filled ? 'filled' : 'empty'}
            />
          )
        })}
      </g>
    </svg>
  )
}
