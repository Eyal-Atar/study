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

// The ring of the level, as the mockup's .lvl: a circle of 34px with a 4px band, whose length is
// counted as 100, so the arc is the percentage; inside the band a surface centre with the level.
const RING_SIZE = 34
const RING_STROKE = 4
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

// The streak and the level in the header, as a link to the progress board (S31 decision 12), in
// the two parts of the mockup's chip (decision 29): a green pill with a leaf and the days of the
// streak (the garden of Archie grows from it, decision 21), and a 34px gold ring around the level
// that fills towards the next one. One accessible name says both ("רצף של 5 ימים, רמה 3"); the
// numbers and the drawings are for the eye, so the gold, which is decoration and not 3:1 on its
// track, carries nothing that the number does not say. An extra and not something the user needs:
// while GET /progress loads, or after it failed, the chip is simply not there, with no spinner and
// no error. It reads the query of the progress board, which every block action refreshes
// (progressKey is a child of the board key). S33 replaces it with the full gamification, and the
// ring's animations.
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
        'inline-flex min-h-touch shrink-0 items-center gap-2 rounded-full px-1 text-ink hover:bg-surface-muted',
        FOCUS_RING_NATIVE,
      )}
    >
      <span
        data-part="streak"
        className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-caption font-semibold text-brand-strong"
      >
        <Leaf aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className="shrink-0 text-brand-strong" />
        <span className="tabular-nums">{streak.current}</span>
      </span>
      <span data-part="level" className="relative inline-flex size-[34px] shrink-0 items-center justify-center">
        {/* Turned a quarter back, so the arc starts at the top. */}
        <svg
          aria-hidden="true"
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${String(RING_SIZE)} ${String(RING_SIZE)}`}
          className="absolute inset-0 -rotate-90"
        >
          <circle data-part="centre" cx={RING_CENTER} cy={RING_CENTER} r={RING_RADIUS} className="fill-surface" />
          <circle
            data-part="track"
            cx={RING_CENTER}
            cy={RING_CENTER}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            className="stroke-gold-track"
          />
          {/* No arc at 0%: the band would still show its end. */}
          {percent > 0 ? (
            <circle
              data-part="arc"
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_RADIUS}
              fill="none"
              strokeWidth={RING_STROKE}
              pathLength={100}
              strokeDasharray={`${percent.toFixed(1)} 100`}
              className="stroke-gold"
            />
          ) : null}
        </svg>
        <span data-part="value" className="relative text-caption leading-none font-bold tabular-nums">
          {level}
        </span>
      </span>
    </Link>
  )
}
