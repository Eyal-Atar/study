import { useEffect, useMemo, useRef, useState } from 'react'
import { useToday } from '../board/api'
import { blockName } from '../board/blockName'
import { useReview, useReviewActions } from '../board/review'
import { dateIn, dayLabel, formatRange, useProfileTimezone } from '../board/time'
import type { Block } from '../board/types'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'

type Action = 'complete' | 'moveToday' | 'skip'

// The morning review (S18): every planned block that ended without a mark, with "בוצע", "העבר
// להיום" and "דלג". Nothing shows while there is nothing to decide (or the review did not load):
// the card is a question, not a status.
//
// Focus (decision 14a): an action takes its row off the card, so the focus moves to the first button
// of the next row, else of the one before, else to the heading. The card stays (with a short line)
// after its last row went, until the screen is left, so the heading is still there to hold it.
export function ReviewCard() {
  const review = useReview()
  const today = useToday()
  const tz = useProfileTimezone()
  const actions = useReviewActions()
  const sectionRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // The block the last press acted on, and the rows as they were before this render.
  const acted = useRef<string | null>(null)
  const previous = useRef<string[]>([])
  const [touched, setTouched] = useState(false)

  // "בוצע" marks the block done in the cache at once (review.ts), so only planned blocks are rows.
  const blocks = useMemo(() => (review.data?.blocks ?? []).filter((b) => b.status === 'planned'), [review.data])
  const ids = useMemo(() => blocks.map((b) => b.id), [blocks])

  useEffect(() => {
    const before = previous.current
    previous.current = ids
    const target = acted.current
    if (target === null || !before.includes(target) || ids.includes(target)) return
    acted.current = null
    const at = before.indexOf(target)
    const next = before.slice(at + 1).find((id) => ids.includes(id)) ?? before.slice(0, at).reverse().find((id) => ids.includes(id))
    const element =
      next === undefined ? headingRef.current : (sectionRef.current?.querySelector<HTMLElement>(`[data-review-row="${next}"] button`) ?? null)
    element?.focus()
  }, [ids])

  if (blocks.length === 0 && !touched) return null

  const todayDate = today.data?.date ?? dateIn(tz)
  const start = (action: Action, block: Block) => {
    acted.current = block.id
    setTouched(true)
    actions[action](block)
  }

  return (
    <section
      ref={sectionRef}
      aria-labelledby="review-title"
      className="space-y-3 rounded-xl border border-line border-s-4 border-s-warning bg-surface p-4"
    >
      <div className="space-y-1">
        <h2 id="review-title" ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
          {he.review.title}
        </h2>
        <p className="text-sm text-ink-muted">{blocks.length === 0 ? he.review.allDone : he.review.lead(blocks.length)}</p>
      </div>
      {blocks.length === 0 ? null : (
        <ul className="divide-y divide-line">
          {blocks.map((block) => {
            const titleId = `review-${block.id}-title`
            const name = blockName(block)
            const pending = actions.pending(block.id)
            return (
              <li key={block.id} data-review-row={block.id} aria-labelledby={titleId} className="space-y-3 py-3 first:pt-1 last:pb-0">
                <div className="space-y-0.5">
                  <h3 id={titleId} className="font-semibold">
                    {block.task_title}
                  </h3>
                  <p className="text-sm text-ink-muted">
                    {he.review.when(dayLabel(block.study_date, todayDate))}
                    <span dir="ltr" className="tabular-nums">
                      {formatRange(block, tz)}
                    </span>
                  </p>
                  <p className="text-sm text-ink-muted">
                    {block.exam_name}
                    {block.part_count > 1 ? `, ${he.board.part(block.part_index, block.part_count)}` : null}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    aria-label={he.review.completeLabel(name)}
                    isDisabled={pending}
                    onPress={() => {
                      start('complete', block)
                    }}
                  >
                    {he.review.complete}
                  </Button>
                  <Button
                    variant="secondary"
                    aria-label={he.review.moveTodayLabel(name)}
                    isDisabled={pending}
                    onPress={() => {
                      start('moveToday', block)
                    }}
                  >
                    {actions.moving(block.id) ? he.review.moving : he.review.moveToday}
                  </Button>
                  <Button
                    variant="quiet"
                    aria-label={he.review.skipLabel(name)}
                    isDisabled={pending}
                    onPress={() => {
                      start('skip', block)
                    }}
                  >
                    {he.review.skip}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
