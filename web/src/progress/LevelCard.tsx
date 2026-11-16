import { useId } from 'react'
import { ProgressBar } from 'react-aria-components'
import { he } from '../i18n/he'
import { formatNumber } from './format'
import type { Progress } from './types'

const t = he.progress.level

// The level as the one large number of the board, and a thin bar of the XP inside this level.
// The bar counts from the start of the level (0) to the size of the level, so its values are the
// XP already earned here and the XP the level needs, not the running total.
export function LevelCard({ progress }: { progress: Progress }) {
  const titleId = useId()
  const { level, total_xp: total, level_start_xp: start, next_level_xp: next } = progress
  const atTop = next === null || level >= progress.max_level

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
      <h2 id={titleId} className="sr-only">
        {t.title}
      </h2>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <p className="text-4xl font-bold leading-none text-ink tabular-nums">{t.level(level)}</p>
        <p className="text-ink-muted tabular-nums">{t.totalXp(formatNumber(total))}</p>
      </div>
      {atTop ? (
        <p className="font-medium text-brand-strong">{t.max}</p>
      ) : (
        <LevelBar level={level} earned={Math.max(0, total - start)} size={Math.max(1, next - start)} />
      )}
      <p className="text-sm text-ink-muted">{t.blocksDone(progress.blocks_done)}</p>
    </section>
  )
}

function LevelBar({ level, earned, size }: { level: number; earned: number; size: number }) {
  const value = Math.min(earned, size)
  return (
    <div className="flex flex-col gap-2">
      <ProgressBar
        value={value}
        minValue={0}
        maxValue={size}
        aria-label={t.barLabel(level + 1)}
        valueLabel={t.barValue(formatNumber(value), formatNumber(size))}
      >
        {({ percentage }) => (
          <div className="h-2 w-full overflow-hidden rounded-full bg-brand-soft">
            <div className="h-full rounded-full bg-brand" style={{ width: `${String(percentage ?? 0)}%` }} />
          </div>
        )}
      </ProgressBar>
      <p className="text-sm text-ink-muted tabular-nums">{t.toNext(formatNumber(size - value), level + 1)}</p>
    </div>
  )
}
