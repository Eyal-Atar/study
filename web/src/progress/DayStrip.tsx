import { he } from '../i18n/he'
import { weekdayOf } from './format'
import type { Progress } from './types'

const t = he.progress.days

// The last 14 study days as a row of quiet cells: filled where something was done, an outline where
// not (never red, spec 7.9), today with a ring. The cells are decoration for the eye; the sentence
// under them says the same for a screen reader.
export function DayStrip({ days, today }: { days: Progress['days']; today: string }) {
  const studied = days.filter((d) => d.xp > 0).length
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm text-ink-muted">{t.title}</h3>
      <ol aria-hidden="true" className="grid grid-cols-14 gap-1">
        {days.map((day) => (
          <li key={day.date} className="flex flex-col items-center gap-1">
            <span
              className={`block aspect-square w-full max-w-6 rounded-md ${
                day.xp > 0 ? 'bg-brand' : 'border border-line-strong bg-surface'
              } ${day.date === today ? 'ring-2 ring-brand-strong ring-offset-2 ring-offset-surface' : ''}`}
            />
            <span className="text-xs text-ink-muted">{t.weekdayLetters[weekdayOf(day.date)]}</span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-ink-muted">{t.summary(studied, days.length)}</p>
    </div>
  )
}
