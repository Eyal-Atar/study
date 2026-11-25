import type { JSX, ReactNode } from 'react'
import type { BadgeGroup } from '../progress/types'
import { PAPER } from '../ui/icons/Icon'
import { DOT_LINE, DOT_R, STONE_LINE, STONE_SHAPES } from './stoneShapes'

/*
  The badge stones (S33, plan decision 6): one stone per group, each with its own silhouette, so the
  five tell apart with no colour at all. A symbol is cut into the stone, redrawn here on the line
  of the icon set (1.75, round caps and joins, the "paper" layer of currentColor under the line),
  and a row of dots under it tells the tier within the group: an earned stone fills its dots up to
  the tier; a stone not yet earned has only open dots.

  A 48 grid with 3 units of air on every side (the geometry is in stoneShapes.ts). The stone has no
  colour of its own: earned is gold (gold-soft under a gold-ink line), not yet earned is a dashed
  outline on surface-muted. Both tokens exist in the day and in the dusk theme, so the stone
  follows the theme with no branch.

  Decoration only: the tile beside it says the badge in words.
*/

// The symbols, on the 24 grid of the icon set. Every line is divided by the scale of the group, so
// it keeps its width in the 48 grid; the paper layer is currentColor, the text colour of the group.
function symbolOf(group: BadgeGroup, scale: number): ReactNode {
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
    // The XP spark (XpSparkIcon), with its small sparkle on the thinner line of the icon.
    case 'xp':
      return (
        <>
          <path d="M10 5c.7 5 3 7.3 8 8-5 .7-7.3 3-8 8-.7-5-3-7.3-8-8 5-.7 7.3-3 8-8Z" {...PAPER} />
          <path
            d="M18.5 2.75c.3 1.7 1.05 2.45 2.75 2.75-1.7.3-2.45 1.05-2.75 2.75-.3-1.7-1.05-2.45-2.75-2.75 1.7-.3 2.45-1.05 2.75-2.75Z"
            strokeWidth={1.25 / scale}
          />
        </>
      )
  }
}

/** The stone alone, with no symbol and no dots: a <g> for the garden to place in its own SVG. */
export function StoneShape({ group, earned }: { group: BadgeGroup; earned: boolean }): JSX.Element {
  const shape = STONE_SHAPES[group]
  const stone = earned ? 'fill-gold-soft stroke-gold-ink' : 'fill-surface-muted stroke-line-strong'
  // A dashed line keeps butt caps: round caps close the gaps of "3 3" at small sizes.
  const dash = earned ? {} : ({ strokeDasharray: '3 3', strokeLinecap: 'butt' } as const)
  return (
    <g strokeWidth={STONE_LINE} strokeLinecap="round" strokeLinejoin="round">
      {shape.stones.map((d) => (
        <path key={d} d={d} data-part="stone" className={stone} {...dash} />
      ))}
      {shape.facets?.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          strokeWidth={1}
          className={earned ? 'stroke-gold-ink' : 'stroke-line-strong'}
          {...dash}
        />
      ))}
    </g>
  )
}

/** A badge stone: the stone of its group, its symbol, and `tiers` dots, filled up to `tier` once earned. */
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
  const shape = STONE_SHAPES[group]
  const { cx, cy, scale } = shape.symbol
  const ink = earned ? 'stroke-gold-ink text-gold-ink' : 'stroke-ink-muted text-ink-muted'
  const firstDot = 24 - ((tiers - 1) * shape.dotGap) / 2
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
        strokeWidth={STONE_LINE / scale}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={ink}
      >
        {symbolOf(group, scale)}
      </g>
      <g strokeWidth={DOT_LINE}>
        {Array.from({ length: tiers }, (_, i) => {
          const filled = earned && i < tier
          const tone = earned
            ? filled
              ? 'fill-gold-ink stroke-gold-ink'
              : 'stroke-gold-ink'
            : 'stroke-line-strong'
          return (
            <circle
              key={i}
              cx={firstDot + i * shape.dotGap}
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
