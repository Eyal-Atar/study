import type { ReactNode } from 'react'
import { ProgressBar as AriaProgressBar } from 'react-aria-components'
import { examColor } from './examColor'
import { cx } from './styles'

// The marks of an exam in its own colour (S34): the square with its initial, the thin bar of its
// progress, and the chip of the days left. All of them take the colour only through examColor().

export interface ExamInitialProps {
  name: string
  colorIndex: number | null | undefined
  // md: 42px, the tile of the exams list. lg: 44px, beside the title of the exam screen.
  size?: 'md' | 'lg'
}

// The first letter or digit of a name, past spaces and quotes.
function initial(name: string): string {
  const letter = /[\p{L}\p{N}]/u.exec(name)?.[0]
  return letter ?? ''
}

// The square of the mockup: the strong colour of the exam on its soft fill, 20px and 700. That is
// large text by WCAG (18.66px bold and up), so 3:1 is the bar, and exam-N on exam-N-soft is
// checked as a large-text pair (theme.test.ts, S34). Only at this size and weight (S34 decision 13).
// It repeats the name beside it, so it is hidden from a screen reader.
export function ExamInitial({ name, colorIndex, size = 'md' }: ExamInitialProps) {
  const colour = examColor(colorIndex)
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-[13px] text-title font-bold',
        size === 'lg' ? 'size-[44px]' : 'size-[42px]',
        colour.soft,
        colour.text,
      )}
    >
      {initial(name)}
    </span>
  )
}

export interface ExamProgressBarProps {
  colorIndex: number | null | undefined
  value: number
  max: number
  'aria-label': string
  // The value in words, read as aria-valuetext ("42% of the plan", "no tasks yet").
  valueText: string
}

// The 5px bar under the name of an exam in the list: the track, filled in the strong
// colour of the exam (exam-N is a checked 3:1 mark on surface; S34 decision 11: here the bar names
// the exam, green stays "done"). With max 0 it is empty.
export function ExamProgressBar({ colorIndex, value, max, 'aria-label': ariaLabel, valueText }: ExamProgressBarProps) {
  const top = max > 0 ? max : 0
  const now = value > 0 ? Math.min(value, top) : 0
  const percent = top === 0 ? 0 : (now / top) * 100
  return (
    <AriaProgressBar value={now} maxValue={top} valueLabel={valueText} aria-label={ariaLabel}>
      <div className="h-[5px] overflow-hidden rounded-full bg-track">
        <div
          data-fill=""
          className={cx('h-full rounded-full transition-[width]', examColor(colorIndex).solid)}
          style={{ width: `${String(percent)}%` }}
        />
      </div>
    </AriaProgressBar>
  )
}

export interface ExamChipProps {
  colorIndex: number | null | undefined
  children: ReactNode
}

// The chip of the days left ("22 days"): a pill in the soft colour of the exam with its line. The
// text is ink, the readable pair on the soft fill; the strong colour is not text at this size.
export function ExamChip({ colorIndex, children }: ExamChipProps) {
  const colour = examColor(colorIndex)
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-small font-semibold whitespace-nowrap text-ink tabular-nums',
        colour.soft,
        colour.line,
      )}
    >
      {children}
    </span>
  )
}
