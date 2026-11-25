import { useId } from 'react'
import { ArchiSays } from '../calendar/ArchiSays'
import { enGarden } from '../i18n/enGarden'
import { en } from '../i18n/en'
import { Card } from '../ui/Card'
import { StreakLeafIcon } from '../ui/icons'
import type { Progress } from './types'

const t = en.progress.streak

const BADGE_SIZE = 58
const LEAF_SIZE = 30

// The streak in study days. Zero is an invitation, and a streak not yet extended today is still
// alive until the day ends (plan decision 6), so the line under it only says what keeps it going.
// A streak that ended after a longer run is not shamed: Archi says it paused and how to start again.
export function StreakCard({ progress }: { progress: Progress }) {
  const titleId = useId()
  const { current, longest, studied_today: studiedToday } = progress.streak
  const paused = current === 0 && longest > 0
  const note = current === 0 ? t.start : studiedToday ? t.studiedToday : t.keepGoing

  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-4">
      {/* The number beside the leaf already reads the streak, so the heading is for the outline only. */}
      <h2 id={titleId} className="sr-only">
        {t.title}
      </h2>
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft"
          style={{ width: BADGE_SIZE, height: BADGE_SIZE }}
        >
          <StreakLeafIcon size={LEAF_SIZE} className="text-brand-strong" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-title font-semibold tabular-nums">{t.days(current)}</p>
          <p className="text-small text-ink-muted tabular-nums">{enGarden.streak.longest(t.days(longest))}</p>
        </div>
      </div>
      {paused ? <ArchiSays mood="flow" size="sm">{enGarden.streak.paused}</ArchiSays> : <p className="text-body">{note}</p>}
    </Card>
  )
}
