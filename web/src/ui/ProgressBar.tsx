import { Label, ProgressBar as AriaProgressBar } from 'react-aria-components'

interface ProgressBarBase {
  value: number
  // Defaults to 100.
  max?: number
  // The value in words ("60 מתוך 345 דקות"): shown at the end of the row, and read as
  // aria-valuetext. Without it the value is the rounded percentage ("40%"), which is shown only
  // beside a visible label.
  valueText?: string | undefined
}

// A meter needs a name: either the visible `label` above it, or an `aria-label` when the place
// already says what it measures (a thin bar inside the row of an exam).
export type ProgressBarProps = ProgressBarBase &
  (
    | {
        // The name of the meter, shown above it and read by a screen reader.
        label: string
        'aria-label'?: string | undefined
      }
    | {
        label?: undefined
        // The name for a screen reader, when there is no visible label.
        'aria-label': string
      }
  )

// How far along something is (design language 5.6): one row with the label and the value, and
// under it a 4px track with a green fill. Green is the colour of "done", so this is for progress
// of work, not for a quota or a warning. With only an aria-label and no valueText it is the track
// alone.
export function ProgressBar({ label, 'aria-label': ariaLabel, value, max = 100, valueText }: ProgressBarProps) {
  // A plan with no minutes has max 0: an empty bar, and no division by zero. NaN fails both tests.
  const top = max > 0 ? max : 0
  const now = value > 0 ? Math.min(value, top) : 0
  const percent = top === 0 ? 0 : (now / top) * 100
  const text = valueText ?? `${String(Math.round(percent))}%`
  const hasRow = label !== undefined || valueText !== undefined
  return (
    <AriaProgressBar value={now} maxValue={top} valueLabel={text} aria-label={ariaLabel} className="flex flex-col gap-1">
      {hasRow ? (
        <div className="flex items-baseline justify-between gap-3">
          {label === undefined ? null : <Label className="text-small text-ink-muted">{label}</Label>}
          {/* ms-auto keeps the value at the end of the row when there is no label before it. */}
          <span className="ms-auto text-small font-semibold tabular-nums">{text}</span>
        </div>
      ) : null}
      <div className="h-1 overflow-hidden rounded-full bg-line">
        <div data-fill="" className="h-full rounded-full bg-success transition-[width]" style={{ width: `${String(percent)}%` }} />
      </div>
    </AriaProgressBar>
  )
}
