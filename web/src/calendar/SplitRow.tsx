import { useEffect, useRef } from 'react'
import type { Me } from '../api/me'
import { dayLabel, durationText, formatRange } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import type { Exam } from '../onboarding/types'
import { Button } from '../ui/Button'
import { examColor } from '../ui/examColor'
import { KIND_ICON } from '../ui/icons'
import { cx, ICON_STROKE } from '../ui/styles'
import { Row, type RowProps } from './BannerRow'
import type { Ghost } from './ghost'
import { useSplitActions } from './splitActions'
import { evenParts, splitColorIndex, splitGhosts, studyDateOf, type SplitOffer } from './splitOffers'

export interface SplitRowProps extends RowProps {
  offer: SplitOffer
  // What is on the calendar: the blocks the split would release, and the colour of the task.
  blocks: Block[]
  exams: Exam[]
  me: Me | undefined
  tz: string
  now: number
  today: string
}

// The split offer (S44): Archi noticed a task that keeps being pushed back, and offers, once, to
// cut it into smaller bites.
//
// Closed, it is his question and "Show me". Open, it says where every bite would go, in words, with
// the button that splits and "Not now"; and for as long as it is open the same is drawn on the grid:
// a ghost for each bite, and "Will move" on the blocks the split releases. The ghosts are a picture
// only (aria-hidden), so the list here is what says it. Nothing is written before the button.
//
// The number of bites and their length are the server's (offer.parts, offer.bite_minutes).
// The toasts, the Undo and every error belong to the actions (splitActions.ts), which outlive this row.
export function SplitRow({ expanded, onToggle, onPreview, offer, blocks, exams, me, tz, now, today }: SplitRowProps) {
  const s = en.calendar.side.banner.split
  const actions = useSplitActions()
  const splitting = actions.splitting(offer.task_id)
  const colorIndex = splitColorIndex(offer, blocks, exams)
  const ghosts = splitGhosts({ offer, blocks, colorIndex, me, tz, now })
  const KindIcon = KIND_ICON[offer.task_kind]
  const tint = examColor(colorIndex).text

  // The preview lives exactly as long as the row is open: closing it, another row opening in its
  // place, or the row leaving the banner (the split, "Not now", an offer that went stale, another
  // screen) clears it. The key is the ghosts themselves, so a refresh that changed nothing draws nothing.
  const previewRef = useRef(onPreview)
  const ghostsRef = useRef<Ghost[]>(ghosts)
  useEffect(() => {
    previewRef.current = onPreview
    ghostsRef.current = ghosts
  })
  const key = JSON.stringify(ghosts)
  useEffect(() => {
    if (!expanded) return
    previewRef.current(ghostsRef.current)
    return () => {
      previewRef.current([])
    }
  }, [expanded, key])

  return (
    <Row
      name="split"
      mood="wisdom"
      expanded={expanded}
      onToggle={onToggle}
      label={expanded ? en.calendar.side.banner.close : s.show}
      panel={
        <div className="flex flex-col gap-3 text-small">
          <div className="flex flex-col gap-1">
            <p>{s.where(offer.parts.length)}</p>
            <ul className="flex flex-col gap-1">
              {offer.parts.map((part) => (
                <li key={part.starts_at} className="flex items-start gap-2">
                  {/* On the first line of the text, also when it wraps. */}
                  <KindIcon aria-hidden size={16} strokeWidth={ICON_STROKE} className={cx('mt-0.5 shrink-0', tint)} />
                  <span className="min-w-0 font-semibold tabular-nums">
                    {s.part(dayLabel(studyDateOf(part.starts_at, me, tz), today), formatRange(part, tz), durationText(part.minutes))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {/* The split also takes the task's other blocks that are still ahead: said, not left to the grid. */}
          {offer.split_minutes === offer.block.minutes ? null : <p>{s.whole(durationText(offer.split_minutes))}</p>}
          <div className="grid grid-cols-[1.5fr_1fr] gap-2">
            <Button
              isPending={splitting}
              onPress={() => {
                actions.split(offer)
              }}
            >
              {s.action(offer.parts.length, offer.bite_minutes, evenParts(offer))}
            </Button>
            <Button
              variant="secondary"
              isDisabled={splitting}
              onPress={() => {
                actions.dismiss(offer)
              }}
            >
              {s.notNow}
            </Button>
          </div>
        </div>
      }
    >
      {s.say(offer.task_title, offer.block.minutes, offer.bite_minutes)}
    </Row>
  )
}
