import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { badgeName, knownBadgeName } from './badgeNames'

// The one place that turns a badge key into its name (S33 fix wave 12): the garden, the badge grid,
// the celebration sheet and the toast of Done all read it.

describe('badge names', () => {
  it('a known key has its name', () => {
    expect(badgeName('iron_will_7')).toBe(en.progress.badges.items.iron_will_7.name)
    expect(knownBadgeName('iron_will_7')).toBe(en.progress.badges.items.iron_will_7.name)
  })

  it('a key from a newer server falls back to the generic name, or to null when asked for a known one', () => {
    expect(badgeName('from_the_future')).toBe(en.progress.badges.unknown.name)
    expect(knownBadgeName('from_the_future')).toBeNull()
  })

  it('a key that is a property of every object is not a badge', () => {
    expect(knownBadgeName('constructor')).toBeNull()
    expect(badgeName('toString')).toBe(en.progress.badges.unknown.name)
  })
})
