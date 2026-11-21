import { useId } from 'react'
import { en } from '../i18n/en'
import { Card } from '../ui/Card'
import { ProgressBar } from '../ui/ProgressBar'
import { formatNumber } from './format'
import type { Progress } from './types'

const t = en.progress.level

// The level as the one large number of the board, and a thin bar of the XP inside this level.
// The bar counts from the start of the level (0) to the size of the level, so its values are the
// XP already earned here and the XP the level needs, not the running total. What is left to the
// next level is not said again in words: the row of the bar already says it.
export function LevelCard({ progress }: { progress: Progress }) {
  const titleId = useId()
  const { level, total_xp: total, level_start_xp: start, next_level_xp: next } = progress
  const atTop = next === null || level >= progress.max_level
  const size = atTop ? 0 : Math.max(1, next - start)
  const earned = Math.min(Math.max(0, total - start), size)

  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-4">
      {/* The large number under it already reads "רמה 4", so the heading is for the outline only. */}
      <h2 id={titleId} className="sr-only">
        {t.title}
      </h2>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-display font-semibold tabular-nums">{t.level(level)}</p>
        <p className="text-small text-ink-muted tabular-nums">{t.totalXp(formatNumber(total))}</p>
      </div>
      {atTop ? (
        <p className="text-small font-semibold">{t.max}</p>
      ) : (
        <ProgressBar
          label={t.barLabel(level + 1)}
          value={earned}
          max={size}
          valueText={t.barValue(formatNumber(earned), formatNumber(size))}
        />
      )}
      <p className="text-small text-ink-muted">{t.blocksDone(progress.blocks_done)}</p>
    </Card>
  )
}
