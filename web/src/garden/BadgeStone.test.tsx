import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeBadges } from '../progress/testFixtures'
import type { BadgeGroup } from '../progress/types'
import { BadgeStone, StoneShape } from './BadgeStone'
import { badgeTier } from './model'
import { DOT_LINE, DOT_R, STONE_LINE, STONE_SHAPES } from './stoneShapes'

// The badge stones of S33 (plan decision 6): one stone per group, a symbol cut into it, and a row
// of tier dots. Every badge of the server's list, through badgeTier, so the tiers are the real ones.
const BADGES = makeBadges()
const GROUPS: BadgeGroup[] = ['first', 'blocks', 'streak', 'level', 'xp']

function stone(props: Parameters<typeof BadgeStone>[0]) {
  const { container } = render(<BadgeStone {...props} />)
  const svg = container.querySelector('svg')
  if (svg === null) throw new Error('no svg')
  return svg
}

describe('BadgeStone', () => {
  it.each(BADGES.map((badge) => badge.key))('%s: names its group and fills one dot per tier', (key) => {
    const { group, tier, tiers } = badgeTier(BADGES, key)
    const svg = stone({ group, tier, tiers, earned: true })

    expect(svg).toHaveAttribute('data-group', group)
    expect(svg.querySelectorAll('[data-dot="filled"]')).toHaveLength(tier)
    expect(svg.querySelectorAll('[data-dot]')).toHaveLength(tiers)
  })

  it('covers all five groups', () => {
    expect(new Set(BADGES.map((badge) => badge.group))).toEqual(new Set(GROUPS))
  })

  it.each(GROUPS)('%s earned: a gold stone with no dashes', (group) => {
    const svg = stone({ group, tier: 1, tiers: 1, earned: true })

    expect(svg.querySelector('.fill-gold-soft')).not.toBeNull()
    expect(svg.querySelector('[stroke-dasharray]')).toBeNull()
  })

  it.each(GROUPS)('%s not yet earned: dashed, and no gold', (group) => {
    const svg = stone({ group, tier: 2, tiers: 3, earned: false })

    expect(svg.querySelector('[stroke-dasharray]')).not.toBeNull()
    expect(svg.querySelector('.fill-gold-soft')).toBeNull()
    expect(svg.querySelector('[class*="gold"]')).toBeNull()
  })

  it.each(BADGES.map((badge) => badge.key))('%s not yet earned: only open dots', (key) => {
    const { group, tier, tiers } = badgeTier(BADGES, key)
    const svg = stone({ group, tier, tiers, earned: false })

    expect(svg.querySelectorAll('[data-dot="filled"]')).toHaveLength(0)
    expect(svg.querySelectorAll('[data-dot="empty"]')).toHaveLength(tiers)
  })

  it('a dashed outline has butt caps, so the gaps stay open at small sizes', () => {
    const svg = stone({ group: 'first', tier: 1, tiers: 1, earned: false })
    const outline = svg.querySelector('[data-part="stone"]')

    expect(outline).toHaveAttribute('stroke-dasharray', '3 3')
    expect(outline).toHaveAttribute('stroke-linecap', 'butt')
  })

  it('the paper layer is currentColor, under a text colour token', () => {
    const earned = stone({ group: 'xp', tier: 1, tiers: 3, earned: true })
    const paper = earned.querySelector('[fill-opacity]')
    expect(paper).toHaveAttribute('fill', 'currentColor')
    expect(paper?.closest('g')).toHaveClass('text-gold-ink')

    const notYet = stone({ group: 'xp', tier: 1, tiers: 3, earned: false })
    expect(notYet.querySelector('[fill-opacity]')?.closest('g')).toHaveClass('text-ink-muted')
  })

  it('is decoration: aria-hidden, with no role', () => {
    const svg = stone({ group: 'streak', tier: 3, tiers: 5, earned: true })

    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
  })

  it('is 48px by default, on a 48 grid, and takes a size and a class', () => {
    const plain = stone({ group: 'xp', tier: 1, tiers: 3, earned: true })
    expect(plain).toHaveAttribute('viewBox', '0 0 48 48')
    expect(plain).toHaveAttribute('width', '48')
    expect(plain).toHaveAttribute('height', '48')

    const big = stone({ group: 'xp', tier: 1, tiers: 3, earned: true, size: 72, className: 'shrink-0' })
    expect(big).toHaveAttribute('width', '72')
    expect(big).toHaveClass('shrink-0')
  })

  it('draws the five stones with five different outlines', () => {
    const outlines = GROUPS.map((group) => {
      const svg = stone({ group, tier: 1, tiers: 1, earned: true })
      return [...svg.querySelectorAll('[data-part="stone"]')].map((el) => el.getAttribute('d')).join('|')
    })
    expect(new Set(outlines).size).toBe(5)
  })
})

// The x where a stone's outline crosses a horizontal line, read from the path data itself: the
// path is walked as lines and cubic curves (the commands stoneShapes.ts uses), sampled finely.
function crossings(d: string, y: number): number[] {
  const tokens: string[] = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? []
  const token = (k: number): string => tokens[k] ?? ''
  const points: [number, number][] = []
  let x0 = 0
  let y0 = 0
  let start: [number, number] = [0, 0]
  let lastCtrl = null as [number, number] | null
  let cmd = ''
  let i = 0
  const num = () => Number(token(i++))
  const cubic = (c1: [number, number], c2: [number, number], end: [number, number]) => {
    for (let s = 1; s <= 200; s++) {
      const t = s / 200
      const u = 1 - t
      points.push([
        u * u * u * x0 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
        u * u * u * y0 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
      ])
    }
    lastCtrl = c2
    ;[x0, y0] = end
  }
  const line = (end: [number, number]) => {
    points.push(end)
    lastCtrl = null
    ;[x0, y0] = end
  }
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(token(i))) cmd = token(i++)
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? x0 : 0
    const oy = rel ? y0 : 0
    switch (cmd.toUpperCase()) {
      case 'M':
        x0 = ox + num()
        y0 = oy + num()
        start = [x0, y0]
        points.push(start)
        cmd = rel ? 'l' : 'L'
        break
      case 'L':
        line([ox + num(), oy + num()])
        break
      case 'H':
        line([ox + num(), y0])
        break
      case 'V':
        line([x0, oy + num()])
        break
      case 'C':
        cubic([ox + num(), oy + num()], [ox + num(), oy + num()], [ox + num(), oy + num()])
        break
      case 'S': {
        const prev: [number, number] = lastCtrl ?? [x0, y0]
        cubic([2 * x0 - prev[0], 2 * y0 - prev[1]], [ox + num(), oy + num()], [ox + num(), oy + num()])
        break
      }
      case 'Z':
        line(start)
        break
      default:
        throw new Error(`Unexpected command ${cmd}`)
    }
  }
  const xs: number[] = []
  points.slice(1).forEach(([bx, by], k) => {
    const [ax, ay] = points[k] ?? [bx, by]
    if ((ay - y) * (by - y) <= 0 && ay !== by) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax))
  })
  return xs
}

describe('the geometry of the stones', () => {
  const tiersOf = (group: BadgeGroup) => BADGES.filter((b) => b.group === group).length

  it('reads a known outline correctly', () => {
    // The facet stone is straight lines: at y 24 it spans 4 to 44.
    const xs = STONE_SHAPES.xp.stones.flatMap((d) => crossings(d, 24))
    expect(Math.min(...xs)).toBeCloseTo(4)
    expect(Math.max(...xs)).toBeCloseTo(44)
  })

  it.each(GROUPS)('%s: the row of dots, with its lines, fits inside the stone with air', (group) => {
    const shape = STONE_SHAPES[group]
    const tiers = tiersOf(group)
    const xs = shape.stones.flatMap((d) => crossings(d, shape.dotsY))
    // The inside of the outline: half the stone's line is on each edge.
    const inner = Math.max(...xs) - Math.min(...xs) - STONE_LINE
    const row = (tiers - 1) * shape.dotGap + 2 * (DOT_R + DOT_LINE / 2)

    expect(row).toBeLessThan(inner)
  })
})

describe('StoneShape', () => {
  it('is a group with no svg of its own, for the garden to place', () => {
    const { container } = render(
      <svg>
        <StoneShape group="level" earned={false} />
      </svg>,
    )
    const root = container.querySelector('svg > g')
    expect(root).not.toBeNull()
    expect(root?.querySelector('svg')).toBeNull()
    expect(root?.querySelector('[stroke-dasharray]')).not.toBeNull()
    expect(root?.querySelector('[data-dot]')).toBeNull()
  })
})
