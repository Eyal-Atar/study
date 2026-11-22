import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Me } from '../api/me'
import { PlanReport } from '../board/PlanReport'
import { useReview } from '../board/review'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import type { Exam } from '../onboarding/types'
import { ReviewCard } from '../today/ReviewCard'
import { Row, type RowProps } from './BannerRow'
import type { Ghost } from './ghost'
import { useSplitOffers } from './splitOffers'
import { SplitRow } from './SplitRow'

// The strip of rows above the calendar: what Archi asks before the day starts. Each row is a
// closed line (Archi, a sentence, a button) that opens in place (Row, BannerRow.tsx); only one is
// open at a time.
//
// A row is a component that takes RowProps and shows only when it has something to say. It is
// listed in BANNER_ROWS, and in the two places below that read the array (the row's component and
// the rule for when it shows).
//
// `onPreview` is the banner's own list of ghosts on the grid (bannerGhosts of CalendarPage), apart
// from the one the sheets write: only the split row (S44) calls it, while it is open.
// The task fixes this array as an export of this file (a plain constant next to the components).
// eslint-disable-next-line react-refresh/only-export-components
export const BANNER_ROWS = ['review', 'report', 'split'] as const
export type BannerRow = (typeof BANNER_ROWS)[number]

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
  // What the split row reads: the blocks on screen, the exams (for the colour), the profile's
  // waking hours, and the clock.
  blocks: Block[]
  exams: Exam[]
  me: Me | undefined
  tz: string
  now: number
  today: string
  // Where the focus goes when the split row leaves from under it (the heading above the banner).
  focusAfter: RefObject<HTMLElement | null>
}

export function CalendarBanner({ unplacedCount, expandTo, onPreview, blocks, exams, me, tz, now, today, focusAfter }: CalendarBannerProps) {
  const review = useReview()
  // One offer at a time, the server's first. While the offers load, or if they fail, there is no
  // row and no message: the offer is an extra, not a state of the screen.
  const offer = useSplitOffers().data?.offers[0]
  const offerId = offer?.task_id
  const [open, setOpen] = useState<BannerRow | null>(expandTo ?? null)
  // The offer left or gave way to the next one: that one shows closed (during the render, so no
  // frame shows it open).
  const [shownOffer, setShownOffer] = useState(offerId)
  if (shownOffer !== offerId) {
    setShownOffer(offerId)
    if (open === 'split') setOpen(null)
  }
  // The buttons of the open row left the tree with it. If the focus fell to the body, it goes to
  // the heading above the banner; the toast says what happened. A focus that is anywhere else stays.
  const last = useRef({ offerId, splitOpen: false })
  useEffect(() => {
    const { offerId: lastId, splitOpen } = last.current
    if (lastId !== offerId && splitOpen && (document.activeElement === null || document.activeElement === document.body)) {
      focusAfter.current?.focus()
    }
    last.current = { offerId, splitOpen: open === 'split' }
  }, [offerId, open, focusAfter])
  const count = (review.data?.blocks ?? []).filter((block) => block.status === 'planned').length
  // The review row stays while it is open, so the last "Done" does not take the row from under the
  // focus: it says it is all done until it is closed.
  const showReview = count > 0 || open === 'review'
  const showReport = unplacedCount > 0
  if (!showReview && !showReport && offer === undefined) return null
  const toggle = (row: BannerRow) => () => {
    setOpen((current) => (current === row ? null : row))
  }
  return (
    <div className="bg-surface">
      {showReview ? <ReviewRow expanded={open === 'review'} onToggle={toggle('review')} onPreview={onPreview} count={count} /> : null}
      {showReport ? (
        <ReportRow expanded={open === 'report'} onToggle={toggle('report')} onPreview={onPreview} count={unplacedCount} scrollOnMount={expandTo === 'report'} />
      ) : null}
      {offer === undefined ? null : (
        <SplitRow
          key={offer.task_id}
          expanded={open === 'split'}
          onToggle={toggle('split')}
          onPreview={onPreview}
          offer={offer}
          blocks={blocks}
          exams={exams}
          me={me}
          tz={tz}
          now={now}
          today={today}
        />
      )}
    </div>
  )
}
