import type { Progress } from './types'

// The share of the way from the start of the level to the next one, 0 to 100. The top level has no
// next one: the ring is full.
export function levelPercent({
  total_xp,
  level_start_xp,
  next_level_xp,
}: Pick<Progress, 'total_xp' | 'level_start_xp' | 'next_level_xp'>): number {
  if (next_level_xp === null) return 100
  const span = next_level_xp - level_start_xp
  if (span <= 0) return 100
  return Math.min(100, Math.max(0, ((total_xp - level_start_xp) / span) * 100))
}
