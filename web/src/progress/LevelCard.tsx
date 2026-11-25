import { useId } from 'react'
import { levelPercent } from './levelPercent'
import { en } from '../i18n/en'
import { Card } from '../ui/Card'
import { formatNumber } from './format'
import { LevelRing } from './LevelRing'
import type { Progress } from './types'

const t = en.progress.level

const RING_SIZE = 58
const RING_STROKE = 6

// The level as a gold ring with the XP of this level beside it (plan decision 17). The ring counts
// from the start of the level to its size, so the words are the XP already earned here and the XP
// the level needs, not the running total. The ring is a drawing: a screen reader gets the same
// words from the name of the group around it.
export function LevelCard({ progress }: { progress: Progress }) {
  const titleId = useId()
  const { level, total_xp: total, level_start_xp: start, next_level_xp: next } = progress
  const atTop = next === null || level >= progress.max_level
  const size = atTop ? 0 : Math.max(1, next - start)
  const earned = Math.min(Math.max(0, total - start), size)
  const words = t.barValue(formatNumber(earned), formatNumber(size))
  const ring = <LevelRing size={RING_SIZE} stroke={RING_STROKE} percent={levelPercent(progress)} level={level} />

  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-4">
      {/* The text beside the ring already reads "Level 4", so the heading is for the outline only. */}
      <h2 id={titleId} className="sr-only">
        {t.title}
      </h2>
      <div className="flex items-center gap-4">
        <div role="img" aria-label={atTop ? t.max : words}>{ring}</div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-title font-semibold tabular-nums">{t.level(level)}</p>
          {atTop ? (
            <p className="text-small font-semibold">{t.max}</p>
          ) : (
            <p className="text-small text-ink-muted tabular-nums">{words}</p>
          )}
          <p className="text-small text-ink-muted tabular-nums">{t.totalXp(formatNumber(total))}</p>
        </div>
      </div>
      <p className="text-small text-ink-muted">{t.blocksDone(progress.blocks_done)}</p>
    </Card>
  )
}
