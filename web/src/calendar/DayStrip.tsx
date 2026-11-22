import { useRef, type KeyboardEvent } from 'react'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { examColor } from '../ui/examColor'
import { StreakLeafIcon } from '../ui/icons'
import { cx } from '../ui/styles'
import { dayDots, weekdayLong, weekdayShort } from './days'

export interface DayStripProps {
  days: string[]
  selected: string
  today: string
  blocks: Block[]
  // The days that kept the streak: a past one shows a leaf instead of its dots.
  streakDays: Set<string>
  onSelect: (date: string) => void
}

const counts = (block: Block) => block.state !== 'missed' && block.state !== 'skipped'

// The week as seven buttons (the .strip of the prototype): the weekday, the date, and under them
// the colours of that day's exams, or a leaf for a past day that kept the streak. One tab stop (the
// selected day); the arrow keys move between days and select them.
export function DayStrip({ days, selected, today, blocks, streakDays, onSelect }: DayStripProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const move = (event: KeyboardEvent, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const target = days[index + (event.key === 'ArrowRight' ? 1 : -1)]
    if (target === undefined) return
    event.preventDefault()
    refs.current[days.indexOf(target)]?.focus()
    onSelect(target)
  }
  return (
    <div role="group" aria-label={en.calendar.side.stripLabel} className="flex gap-[3px] px-3 pb-2.5">
      {days.map((date, index) => {
        const isSelected = date === selected
        const dots = dayDots(blocks, date)
        const leaf = date < today && streakDays.has(date)
        const count = blocks.filter((b) => b.study_date === date && counts(b)).length
        return (
          <button
            key={date}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            tabIndex={isSelected ? 0 : -1}
            aria-pressed={isSelected}
            aria-current={date === today ? 'date' : undefined}
            aria-label={en.calendar.side.stripDay(weekdayLong(date), Number(date.slice(8)), count)}
            onClick={() => {
              onSelect(date)
            }}
            onKeyDown={(event) => {
              move(event, index)
            }}
            className={cx(
              'min-h-touch flex-1 cursor-pointer rounded-[13px] py-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
              isSelected ? 'bg-inverse text-on-inverse' : 'text-ink',
            )}
          >
            <span aria-hidden="true" className="block">
              <span className={cx('block text-[12px]', !isSelected && 'text-ink-muted')}>{weekdayShort(date)}</span>
              <span className="block text-[16px] font-semibold tabular-nums">{Number(date.slice(8))}</span>
              <span className="mt-0.5 flex h-3 items-center justify-center gap-[3px]">
                {leaf ? (
                  <span data-streak-leaf="" className={isSelected ? 'text-on-inverse' : 'text-brand-strong'}>
                    <StreakLeafIcon size={12} />
                  </span>
                ) : (
                  dots.map((color) => (
                    <i key={color} data-dot="" className={cx('size-[5px] rounded-full', examColor(color).solid)} />
                  ))
                )}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
