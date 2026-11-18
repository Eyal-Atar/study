import { Leaf } from 'lucide-react'
import { Link } from 'react-router'
import { he } from '../i18n/he'
import { useProgress } from '../progress/api'
import type { Progress, Streak } from '../progress/types'
import { cx, FOCUS_RING_NATIVE, ICON_STROKE } from '../ui/styles'

// Not imported from routes.tsx: routes imports AppShell, which imports this file.
const PROGRESS_PATH = '/progress'

// What the chip reads of GET /progress.
export type ChipProgress = Pick<Progress, 'level' | 'total_xp' | 'level_start_xp' | 'next_level_xp'> & {
  streak: Pick<Streak, 'current'>
}

// The ring: a circle of 24px whose length is counted as 100, so the arc is the percentage.
const RING_SIZE = 24
const RING_STROKE = 3
const RING_CENTER = RING_SIZE / 2
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2

// The share of the way from the start of the level to the next one, 0 to 100. The top level has no
// next one: the ring is full.
function levelPercent({ total_xp, level_start_xp, next_level_xp }: ChipProgress): number {
  if (next_level_xp === null) return 100
  const span = next_level_xp - level_start_xp
  if (span <= 0) return 100
  return Math.min(100, Math.max(0, ((total_xp - level_start_xp) / span) * 100))
}

// The streak and the level in the header, as a link to the progress board (S31 decision 12): a
// leaf with the days of the streak (the garden of Archie grows from it, decision 21), and a small
// gold ring around the level that fills towards the next one. One accessible name says both
// ("רצף של 5 ימים, רמה 3"); the numbers and the drawings are for the eye, so the gold, which is
// decoration and not 3:1 on its track, carries nothing that the number does not say. An extra and not something the user needs: while GET /progress loads, or after it
// failed, the chip is simply not there, with no spinner and no error. It reads the query of the
// progress board, which every block action refreshes (progressKey is a child of the board key).
// S33 replaces it with the full gamification, and the ring's animations.
export function ProgressChip() {
  const progress = useProgress()
  if (progress.data === undefined) return null
  return <ProgressChipView progress={progress.data} />
}

// The chip itself, from data in hand: the shell gives it the answer of GET /progress, and the
// components page (/dev/components) fixed numbers, since it has no API.
export function ProgressChipView({ progress }: { progress: ChipProgress }) {
  const { streak, level } = progress
  const percent = levelPercent(progress)

  return (
    <Link
      to={PROGRESS_PATH}
      aria-label={he.shell.progressChip(streak.current, level)}
      className={cx(
        'inline-flex min-h-touch shrink-0 items-center gap-2 rounded-full border border-line bg-surface px-3 text-small text-ink hover:bg-surface-muted',
        FOCUS_RING_NATIVE,
      )}
    >
      <span className="inline-flex items-center gap-1">
        <Leaf aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="shrink-0 text-brand-strong" />
        <span className="font-semibold tabular-nums">{streak.current}</span>
      </span>
      <span className="relative inline-flex size-6 shrink-0 items-center justify-center">
        {/* Turned a quarter back, so the arc starts at the top. */}
        <svg
          aria-hidden="true"
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${String(RING_SIZE)} ${String(RING_SIZE)}`}
          className="absolute inset-0 -rotate-90"
        >
          <circle
            data-part="track"
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            className="stroke-surface-muted"
          />
          {/* No arc at 0%: a round cap would still draw a dot. */}
          {percent > 0 ? (
            <circle
              data-part="arc"
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              fill="none"
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={`${percent.toFixed(1)} 100`}
              className="stroke-gold"
            />
          ) : null}
        </svg>
        <span className="relative text-[0.625rem] leading-none font-semibold tabular-nums">{level}</span>
      </span>
    </Link>
  )
}
