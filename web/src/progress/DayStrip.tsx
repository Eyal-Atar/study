import { useId } from 'react'
import { en } from '../i18n/en'
import { enGarden } from '../i18n/enGarden'
import { StreakLeafIcon } from '../ui/icons'
import { SectionHeading } from '../ui/SectionHeading'
import { cx } from '../ui/styles'
import { weekdayOf } from './format'
import type { Progress } from './types'

const t = en.progress.days

const LEAF_SIZE = 18

// The last 14 study days as a row of leaves (plan decision 18): a day with XP is a filled leaf in
// green ("done"), a day without is the outline of a leaf in muted ink (never red, spec 7.9), and
// today has a line under it. Filled, outlined and underlined differ in shape, not only in colour.
// The leaves are decoration for the eye; the sentence beside the title says the same for a screen
// reader and names the 14 days.
export function DayStrip({ days, today }: { days: Progress['days']; today: string }) {
  const titleId = useId()
  const studied = days.filter((d) => d.xp > 0).length
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <SectionHeading id={titleId}>{enGarden.days.title}</SectionHeading>
        <p className="text-small text-ink-muted">{t.summary(studied, days.length)}</p>
      </div>
      <ol aria-hidden="true" className="grid grid-cols-14 gap-1">
        {days.map((day) => {
          const done = day.xp > 0
          const isToday = day.date === today
          return (
            <li
              key={day.date}
              data-day={done ? 'studied' : 'open'}
              {...(isToday ? { 'data-today': '' } : {})}
              className="flex flex-col items-center gap-1"
            >
              {/* The paper layer of the icon is the first path; "studied" fills it solid. */}
              <span className={cx('flex flex-col items-center pb-0.5', isToday && 'border-b-2 border-brand')}>
                <StreakLeafIcon
                  size={LEAF_SIZE}
                  className={cx(done ? 'text-success [&_path:first-child]:fill-current [&_path:first-child]:[fill-opacity:1]' : 'text-ink-muted')}
                />
              </span>
              <span className="text-small text-ink-muted">{t.weekdayLetters[weekdayOf(day.date)]}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
