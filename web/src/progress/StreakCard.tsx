import { useId } from 'react'
import { he } from '../i18n/he'
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
    <section aria-labelledby={titleId} className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-5">
      <h2 id={titleId} className="text-lg font-medium text-ink">
        {t.title}
      </h2>
      <dl className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-ink-muted">{t.current}</dt>
          <dd className="text-2xl font-bold text-ink tabular-nums">{t.days(current)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-ink-muted">{t.longest}</dt>
          <dd className="text-2xl font-bold text-ink tabular-nums">{t.days(longest)}</dd>
        </div>
      </dl>
      <p className="text-ink">{note}</p>
      <DayStrip days={progress.days} today={today} />
    </section>
  )
}
