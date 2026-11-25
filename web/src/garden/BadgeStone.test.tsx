import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeBadges } from '../progress/testFixtures'
import type { BadgeGroup } from '../progress/types'
import { BadgeStone, StoneShape } from './BadgeStone'
import { badgeTier } from './model'

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
