import { useEffect, useMemo, useRef, useState } from 'react'
import { useToday } from '../board/api'
import { blockName } from '../board/blockName'
import { useReview, useReviewActions } from '../board/review'
import { dateIn, dayLabel, formatRange, useProfileTimezone } from '../board/time'
import type { Block } from '../board/types'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'

type Action = 'complete' | 'moveToday' | 'skip'

// The morning review (S18): every planned block that ended without a mark, with "בוצע", "העבר
// להיום" and "דלג". Nothing shows while there is nothing to decide (or the review did not load):
// the card is a question, not a status.
//
// Focus (decision 14a): an action takes its row off the card, so the focus moves to the first button
// of the next row, else of the one before, else to the heading. The card stays (with a short line)
// after its last row went, until the screen is left, so the heading is still there to hold it.
// A move or skip that fails leaves its row: the press is forgotten (a later success from the toast
// must not pull the focus from wherever the user is), and the focus, which the disabled buttons
// dropped to <body>, goes back to the row's first button once they are enabled again.
export function ReviewCard() {
  const review = useReview()
  const today = useToday()
  const tz = useProfileTimezone()
  const actions = useReviewActions()
  const sectionRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // The block the last press acted on, and the rows as they were before this render.
  const acted = useRef<string | null>(null)
  const previous = useRef<string[]>([])
  // The row whose action failed, until its buttons take the focus back.
  const recover = useRef<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [, setFailures] = useState(0)

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

  // After every render: the failed row's buttons stay disabled until the mutation settled.
  useEffect(() => {
    const id = recover.current
    if (id === null) return
    const button = sectionRef.current?.querySelector<HTMLButtonElement>(`[data-review-row="${id}"] button`) ?? null
    if (button?.disabled === true) return
    recover.current = null
    const active = document.activeElement
    if (button !== null && (active === null || active === document.body)) button.focus()
  })

  if (blocks.length === 0 && !touched) return null

  const todayDate = today.data?.date ?? dateIn(tz)
  const start = (action: Action, block: Block) => {
    acted.current = block.id
    setTouched(true)
    if (action === 'complete') {
      // Optimistic: the row goes at once, and a failure brings it back (review.ts).
      actions.complete(block)
      return
    }
    actions[action](block, {
      onError: () => {
        if (acted.current === block.id) acted.current = null
        recover.current = block.id
        setFailures((n) => n + 1)
      },
    })
  }

  return (
    // Card takes no ref, so the element the focus effects search in wraps it. A real box and not
    // display: contents, which would drop the margin the screen puts between its sections.
    <div ref={sectionRef}>
      {/* A plain white card with no primary button (S27 decision 4): the one primary button of the
          screen is "בוצע" of the next task, above this card. */}
      <Card role="region" aria-labelledby="review-title" className="space-y-3">
        <div className="space-y-1">
          <h2 id="review-title" ref={headingRef} tabIndex={-1} className="text-body font-semibold outline-none">
            {he.review.title}
          </h2>
          <p className="text-small text-ink-muted">{blocks.length === 0 ? he.review.allDone : he.review.lead(blocks.length)}</p>
        </div>
        {blocks.length === 0 ? null : (
          <ul>
            {blocks.map((block) => {
              const titleId = `review-${block.id}-title`
              const name = blockName(block)
              const pending = actions.pending(block.id)
              return (
                <li key={block.id} data-review-row={block.id} aria-labelledby={titleId} className="space-y-3 border-t border-line py-3 last:pb-0">
                  <div className="min-w-0 space-y-1">
                    <h3 id={titleId} className="text-body font-semibold break-words">
                      {block.task_title}
                    </h3>
                    <p className="text-small break-words text-ink-muted">
                      {he.review.when(dayLabel(block.study_date, todayDate))}
                      <span dir="ltr" className="tabular-nums">
                        {formatRange(block, tz)}
                      </span>
                      {he.review.details(block.exam_name, block.part_count > 1 ? he.board.part(block.part_index, block.part_count) : null)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
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
      </Card>
    </div>
  )
}
