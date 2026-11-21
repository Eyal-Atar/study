import { Check } from '../ui/icons'
import { useId, useRef } from 'react'
import { actionAriaLabel, actionLabel, isExtra, partSuffix, useBlockControls } from '../board/blockControls'
import { BlockMenu, PinnedMark, StateBadge } from '../board/blockParts'
import { useFocusRequest } from '../board/focus'
import { MoveDialog } from '../board/MoveDialog'
import { blockMinutes, durationText, formatRange } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ICON_STROKE } from '../ui/styles'
import { UserText } from '../ui/UserText'

export interface NextBlockProps {
  block: Block
  tz: string
  // Set when the block is on a later day: "Tomorrow, 09:00". Today's block already shows its time.
  when?: string
}

// The one card the eye lands on first: what to do now. A plain white card (design language 5.1):
// what makes it stand out is the label, the title and the one primary button of the screen, "Done".
// "Defer" is a button too; of the rest, one action is a third button and two go into a menu, since
// four buttons do not fit in a row on a phone (S27 decision 2).
export function NextBlock({ block, tz, when }: NextBlockProps) {
  const { name, available, pending, deferring, start, move } = useBlockControls(block, tz)
  const headingId = useId()
  // The first action is always "Done", or its undo for a done block.
  const main = block.state === 'done' ? 'uncomplete' : 'complete'
  const canDefer = available.includes('defer')
  const rest = available.filter(isExtra).filter((action) => action !== 'defer')
  const [only] = rest
  // After an action on this block the focus comes back to the card's first button (focus.ts).
  const buttonsRef = useRef<HTMLDivElement>(null)
  useFocusRequest(block.id, buttonsRef)

  return (
    <Card role="region" aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-small font-semibold text-brand-strong">
          {en.today.next}
        </h2>
        {when === undefined ? <StateBadge block={block} /> : <p className="text-small font-semibold">{when}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-title font-semibold break-words">
          <UserText>{block.task_title}</UserText>
        </h3>
        <p className="text-small break-words text-ink-muted">
          <span dir="ltr" className="tabular-nums">
            {formatRange(block, tz)}
          </span>
          {en.board.nextMeta(durationText(blockMinutes(block)), block.exam_name, en.board.kinds[block.task_kind])}
          {partSuffix(block)}
          {block.pinned ? (
            <>
              {en.move.detailsJoiner}
              <PinnedMark />
            </>
          ) : null}
        </p>
      </div>
      <div ref={buttonsRef} className="mt-2 flex flex-wrap gap-2">
        <Button
          variant={main === 'complete' ? 'primary' : 'secondary'}
          className="flex-1 sm:max-w-xs"
          aria-label={actionAriaLabel(main, name)}
          isDisabled={pending}
          onPress={() => {
            start(main)
          }}
        >
          {main === 'complete' ? <Check aria-hidden="true" size={18} strokeWidth={ICON_STROKE} /> : null}
          {actionLabel(main)}
        </Button>
        {canDefer ? (
          <Button
            variant="secondary"
            aria-label={actionAriaLabel('defer', name)}
            isDisabled={pending}
            onPress={() => {
              start('defer')
            }}
          >
            {deferring ? en.board.deferring : actionLabel('defer')}
          </Button>
        ) : null}
        {only !== undefined && rest.length === 1 ? (
          <Button
            variant="secondary"
            aria-label={actionAriaLabel(only, name)}
            isDisabled={pending}
            onPress={() => {
              start(only)
            }}
          >
            {actionLabel(only)}
          </Button>
        ) : null}
        {rest.length > 1 ? <BlockMenu name={name} actions={rest} onAction={start} isDisabled={pending} variant="secondary" /> : null}
      </div>
      <MoveDialog {...move} />
    </Card>
  )
}
