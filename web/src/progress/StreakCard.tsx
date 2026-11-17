import { useId } from 'react'
import { he } from '../i18n/he'
import { Card } from '../ui/Card'
import { SectionHeading } from '../ui/SectionHeading'
import { DayStrip } from './DayStrip'
import type { Progress } from './types'

const t = he.progress.streak

// The streak in study days. Zero is an invitation, and a streak not yet extended today is still
// alive until the day ends (plan decision 6), so the line under it only says what keeps it going.
export function StreakCard({ progress }: { progress: Progress }) {
  const titleId = useId()
  const { current, longest, studied_today: studiedToday, today } = progress.streak
  const note = current === 0 ? t.start : studiedToday ? t.studiedToday : t.keepGoing

  return (
    <Card role="region" aria-labelledby={titleId} className="flex flex-col gap-4">
      <SectionHeading id={titleId}>{t.title}</SectionHeading>
      <dl className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <dt className="text-small text-ink-muted">{t.current}</dt>
          <dd className="text-title font-semibold tabular-nums">{t.days(current)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-small text-ink-muted">{t.longest}</dt>
          <dd className="text-title font-semibold tabular-nums">{t.days(longest)}</dd>
        </div>
      </dl>
      <p className="text-body">{note}</p>
      <DayStrip days={progress.days} today={today} />
    </Card>
  )
}
