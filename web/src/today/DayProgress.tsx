import { Label, Meter } from 'react-aria-components'
import { he } from '../i18n/he'

// The minutes of today (decision 11): real minutes from the server, done out of all of today's
// (what is left plus what is done), not a made-up percentage.
export function DayProgress({ done, planned }: { done: number; planned: number }) {
  const total = planned + done
  if (total <= 0) return null
  const text = he.today.progress(done, total)
  return (
    <Meter value={done} minValue={0} maxValue={total} valueLabel={text} className="space-y-2">
      {({ percentage }) => (
        <>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <Label className="text-ink-muted">{he.today.progressLabel}</Label>
            <span className="font-medium tabular-nums">{text}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-success transition-[width] motion-reduce:transition-none" style={{ width: `${String(percentage)}%` }} />
          </div>
        </>
      )}
    </Meter>
  )
}
