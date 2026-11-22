import { useEffect, useId, useRef, useState } from 'react'
import { PlanReport } from '../board/PlanReport'
import { useReview } from '../board/review'
import { en } from '../i18n/en'
import { ReviewCard } from '../today/ReviewCard'
import { Button } from '../ui/Button'
import { ChevronRight } from '../ui/icons'
import { ICON_STROKE } from '../ui/styles'
import type { ArchieMood } from '../archie/Archie'
import { ArchiSays } from './ArchiSays'
import type { Ghost } from './ghost'

// The strip of rows above the calendar: what Archi asks before the day starts. Each row is a
// closed line (Archi, a sentence, a button) that opens in place; only one is open at a time.
//
// The seam for S44 (the split-and-bite proposals): a new row is a component that takes
// `{ expanded: boolean; onToggle(): void; onPreview(ghosts: Ghost[]): void }` and shows only when it
// has something to say. It is added to BANNER_ROWS after 'report', and to the two places below
// that read the array (the row's component and the rule for when it shows). In S32 `onPreview` is
// passed to the rows and never called.
// The task fixes this array as an export of this file (a plain constant next to the components).
// eslint-disable-next-line react-refresh/only-export-components
export const BANNER_ROWS = ['review', 'report'] as const
type BannerRow = (typeof BANNER_ROWS)[number]

interface RowProps {
  expanded: boolean
  onToggle: () => void
  onPreview: (ghosts: Ghost[]) => void
}

function Row({
  ref,
  name,
  mood,
  expanded,
  onToggle,
  label,
  children,
  panel,
}: {
  ref?: React.Ref<HTMLDivElement>
  name: BannerRow
  mood: ArchieMood
  expanded: boolean
  onToggle: () => void
  label: string
  children: React.ReactNode
  panel: React.ReactNode
}) {
  const panelId = useId()
  return (
    <div ref={ref} data-banner-row={name} className="border-b border-sand px-3 pt-2">
      <ArchiSays mood={mood} size="sm">
        {children}
      </ArchiSays>
      <div className="flex justify-end pb-1">
        <Button variant="quiet" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} onPress={onToggle}>
          {label}
          <ChevronRight aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className={expanded ? 'rotate-90' : undefined} />
        </Button>
      </div>
      {expanded ? (
        <div id={panelId} className="pb-3">
          {panel}
        </div>
      ) : null}
    </div>
  )
}

function ReviewRow({ expanded, onToggle, count }: RowProps & { count: number }) {
  return (
    <Row
      name="review"
      mood="intentions"
      expanded={expanded}
      onToggle={onToggle}
      label={expanded ? en.calendar.side.banner.close : en.calendar.side.banner.review}
      panel={<ReviewCard bare />}
    >
      <span className="font-semibold">{en.review.title}</span>
      {/* At nothing left the open card under the line says it is all done, next to where the
          focus falls; said here too, it would be said twice. */}
      {count === 0 ? null : `. ${en.review.lead(count)}`}
    </Row>
  )
}

function ReportRow({ expanded, onToggle, count, scrollOnMount }: RowProps & { count: number; scrollOnMount: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (scrollOnMount) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [scrollOnMount])
  return (
    <Row
      ref={ref}
      name="report"
      mood="flow"
      expanded={expanded}
      onToggle={onToggle}
      label={expanded ? en.calendar.side.banner.close : en.calendar.side.banner.details}
      panel={<PlanReport bare />}
    >
      {en.calendar.side.banner.report(count)}
    </Row>
  )
}

export interface CalendarBannerProps {
  unplacedCount: number
  // Opens the report on mount and scrolls to it (the "what did not fit" link of other screens).
  expandTo?: 'report'
  onPreview: (ghosts: Ghost[]) => void
}

export function CalendarBanner({ unplacedCount, expandTo, onPreview }: CalendarBannerProps) {
  const review = useReview()
  const [open, setOpen] = useState<BannerRow | null>(expandTo ?? null)
  const count = (review.data?.blocks ?? []).filter((block) => block.status === 'planned').length
  // The review row stays while it is open, so the last "Done" does not take the row from under the
  // focus: it says it is all done until it is closed.
  const showReview = count > 0 || open === 'review'
  const showReport = unplacedCount > 0
  if (!showReview && !showReport) return null
  const toggle = (row: BannerRow) => () => {
    setOpen((current) => (current === row ? null : row))
  }
  return (
    <div className="bg-surface">
      {showReview ? <ReviewRow expanded={open === 'review'} onToggle={toggle('review')} onPreview={onPreview} count={count} /> : null}
      {showReport ? (
        <ReportRow expanded={open === 'report'} onToggle={toggle('report')} onPreview={onPreview} count={unplacedCount} scrollOnMount={expandTo === 'report'} />
      ) : null}
    </div>
  )
}
