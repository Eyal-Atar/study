import { Label, ProgressBar as AriaProgressBar } from 'react-aria-components'

export interface ProgressBarProps {
  // The name of the meter, shown above it and read by a screen reader.
  label: string
  value: number
  // Defaults to 100.
  max?: number
  // The value in words ("60 מתוך 345 דקות"): shown at the end of the row, and read as
  // aria-valuetext instead of a bare percentage.
  valueText: string
}

// How far along something is (design language 5.6): one row with the label and the value, and
// under it a 4px track with a green fill. Green is the colour of "done", so this is for progress
// of work, not for a quota or a warning.
export function ProgressBar({ label, value, max = 100, valueText }: ProgressBarProps) {
  // A plan with no minutes has max 0: an empty bar, and no division by zero. NaN fails both tests.
  const top = max > 0 ? max : 0
  const now = value > 0 ? Math.min(value, top) : 0
  const percent = top === 0 ? 0 : (now / top) * 100
  return (
    <AriaProgressBar value={now} maxValue={top} valueLabel={valueText} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="text-small text-ink-muted">{label}</Label>
        <span className="text-small font-semibold tabular-nums">{valueText}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-line">
        <div data-fill="" className="h-full rounded-full bg-success transition-[width]" style={{ width: `${String(percent)}%` }} />
      </div>
    </AriaProgressBar>
  )
}
