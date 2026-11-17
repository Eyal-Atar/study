import { he } from '../i18n/he'
import { cx } from '../ui/styles'
import { weekdayOf } from './format'
import type { Progress } from './types'

const t = he.progress.days

// The last 14 study days as a row of quiet cells: filled in green where something was done (green
// is "done"), an outline where not (never red, spec 7.9), today with a ring. Filled, outlined and
// ringed differ in shape, not only in colour. The cells are decoration for the eye; the sentence
// under them says the same for a screen reader, and names the 14 days, so the strip has no title.
export function DayStrip({ days, today }: { days: Progress['days']; today: string }) {
  const studied = days.filter((d) => d.xp > 0).length
  return (
    // The line separates the strip from the numbers above it (5.1: a line, not a card in a card).
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      {/* gap-1.5: the ring of today (2px and a 2px gap) must not touch the cell beside it. */}
      <ol aria-hidden="true" className="grid grid-cols-14 gap-1.5">
        {days.map((day) => (
          <li key={day.date} className="flex flex-col items-center gap-1">
            <span
              className={cx(
                'block aspect-square w-full max-w-6 rounded-badge',
                day.xp > 0 ? 'bg-success' : 'border border-line-strong bg-surface',
                day.date === today && 'ring-2 ring-brand ring-offset-2',
              )}
            />
            <span className="text-small text-ink-muted">{t.weekdayLetters[weekdayOf(day.date)]}</span>
          </li>
        ))}
      </ol>
      <p className="text-small text-ink-muted">{t.summary(studied, days.length)}</p>
    </div>
  )
}
