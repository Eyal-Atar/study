import type { Badge, BadgeGroup, Progress } from './types'

// Test data for the progress board (only tests import this file).

const BADGES: [string, BadgeGroup, number][] = [
  ['first_task', 'first', 1],
  ['task_master_10', 'blocks', 10],
  ['task_master_20', 'blocks', 20],
  ['task_master_50', 'blocks', 50],
  ['task_master_100', 'blocks', 100],
  ['iron_will_7', 'streak', 7],
  ['iron_will_10', 'streak', 10],
  ['iron_will_14', 'streak', 14],
  ['iron_will_30', 'streak', 30],
  ['iron_will_100', 'streak', 100],
  ['knowledge_seeker_5', 'level', 5],
  ['knowledge_seeker_10', 'level', 10],
  ['knowledge_seeker_20', 'level', 20],
  ['knowledge_seeker_25', 'level', 25],
  ['knowledge_seeker_50', 'level', 50],
  ['xp_1000', 'xp', 1000],
  ['xp_5000', 'xp', 5000],
  ['xp_10000', 'xp', 10000],
]

// All 18 badges, the ones in `earned` earned at that instant.
export function makeBadges(earned: Record<string, string> = {}): Badge[] {
  return BADGES.map(([key, group, threshold]) => ({
    key,
    group,
    threshold,
    earned: key in earned,
    earned_at: earned[key] ?? null,
  }))
}

// 14 days up to 2026-11-16, with XP on the dates in `xp`.
export function makeDays(xp: Record<string, number> = {}): Progress['days'] {
  return Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 10, 3 + i)).toISOString().slice(0, 10)
    return { date, xp: xp[date] ?? 0 }
  })
}

export function makeProgress(overrides: Partial<Progress> = {}): Progress {
  return {
    total_xp: 1240,
    level: 2,
    level_start_xp: 1000,
    next_level_xp: 2000,
    max_level: 50,
    blocks_done: 12,
    streak: { current: 4, longest: 9, studied_today: true, today: '2026-11-16' },
    days: makeDays({ '2026-11-13': 120, '2026-11-14': 80, '2026-11-15': 200, '2026-11-16': 60, '2026-11-05': 100 }),
    badges: makeBadges({ first_task: '2026-11-05T09:00:00Z', task_master_10: '2026-11-12T18:03:00Z', iron_will_7: '2026-11-12T22:30:00Z', xp_1000: '2026-11-14T10:00:00Z' }),
    archive: [],
    ...overrides,
  }
}

// A user who has not studied yet.
export function newUserProgress(): Progress {
  return makeProgress({
    total_xp: 0,
    level: 1,
    level_start_xp: 0,
    next_level_xp: 1000,
    blocks_done: 0,
    streak: { current: 0, longest: 0, studied_today: false, today: '2026-11-16' },
    days: makeDays(),
    badges: makeBadges(),
  })
}
