import { useId, useRef } from 'react'
import { Button } from 'react-aria-components'
import { useBlockActions } from '../board/actions'
import { partSuffix } from '../board/blockControls'
import { blockName } from '../board/blockName'
import { useFocusRequest } from '../board/focus'
import { blockMinutes, durationText, formatRange } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { examColor } from '../ui/examColor'
import { CheckMarkIcon, KIND_ICON } from '../ui/icons'
import { BUTTON_BASE, cx, FOCUS_RING_INVERSE, ICON_STROKE } from '../ui/styles'
import { UserText } from '../ui/UserText'

export interface NextCardProps {
  block: Block
  tz: string
  // Set when the block is on a later day, and shown in place of the time range: "Tomorrow, 09:00".
  when?: string | undefined
  // Defer is a question (to when?), so the calendar answers it with its defer sheet.
  onDefer: (block: Block) => void
  // Without a network (S38): both buttons are disabled.
  readOnly?: boolean
}

// White on the exam's colour is a checked pair (design language 2.6), and so is ink on surface:
// "Done" is the light button, the one the eye finds first; "Defer" is drawn in the card's own white.
// Under the pointer "Defer" turns into the same light button, so no new pair is needed.
const DONE =
  'flex-1 border-transparent bg-surface text-ink data-[hovered]:bg-surface-muted data-[pressed]:bg-surface-muted data-[disabled]:cursor-not-allowed data-[disabled]:bg-surface-muted data-[disabled]:text-ink-muted'
const DEFER =
  'border-on-brand bg-transparent text-on-brand data-[hovered]:bg-surface data-[hovered]:text-ink data-[pressed]:bg-surface data-[pressed]:text-ink data-[disabled]:cursor-not-allowed'

// The card Archi stands on in the sidebar: what to do next, filled with the colour of its exam (the
// .next of the prototype). The only actions here are "Done" and "Defer"; the rest are on the block.
export function NextCard({ block, tz, when, onDefer, readOnly = false }: NextCardProps) {
  const actions = useBlockActions()
  const headingId = useId()
  const name = blockName(block)
  const pending = readOnly || actions.pending(block.id)
  const KindIcon = KIND_ICON[block.task_kind]
  // After an action on this block the focus comes back to the card's first button (board/focus.ts).
  const buttonsRef = useRef<HTMLDivElement>(null)
  useFocusRequest(block.id, buttonsRef)
  return (
    <section
      aria-labelledby={headingId}
      className={cx('rounded-card p-3.5 text-on-brand', examColor(block.exam_color_index).solid)}
    >
      <h3 id={headingId} className="text-small">
        {en.today.next}
      </h3>
      <UserText truncate className="my-0.5 text-[17px] font-semibold">
        {block.task_title}
      </UserText>
      <p className="text-small tabular-nums">
        <span>{when ?? formatRange(block, tz)}</span>
        {en.calendar.side.joiner}
        {durationText(blockMinutes(block))}
        {partSuffix(block)}
      </p>
      <p className="mt-px flex items-center gap-1.5 text-small">
        <KindIcon aria-hidden="true" size={15} strokeWidth={ICON_STROKE} className="shrink-0" />
        <span className="min-w-0 truncate">
          <UserText>{block.exam_name}</UserText>
          {en.calendar.side.joiner}
          {en.board.kinds[block.task_kind]}
        </span>
      </p>
      <div ref={buttonsRef} className="mt-3 flex gap-2">
        <Button
          aria-label={en.board.completeLabel(name)}
          isDisabled={pending}
          onPress={() => {
            actions.complete(block)
          }}
          className={cx(BUTTON_BASE, DONE, FOCUS_RING_INVERSE)}
        >
          <CheckMarkIcon size={17} />
          {en.board.complete}
        </Button>
        <Button
          aria-label={en.board.deferLabel(name)}
          isDisabled={pending}
          onPress={() => {
            onDefer(block)
          }}
          className={cx(BUTTON_BASE, DEFER, FOCUS_RING_INVERSE)}
        >
          {en.board.defer}
        </Button>
      </div>
    </section>
  )
}
