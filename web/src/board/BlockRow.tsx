import { useRef } from 'react'
import { he } from '../i18n/he'
import { Badge } from '../ui/Badge'
import { CheckButton } from '../ui/CheckButton'
import { ListRow } from '../ui/List'
import { isExtra, partSuffix, useBlockControls } from './blockControls'
import { BlockMenu, PinnedMark, StateBadge } from './blockParts'
import { useFocusRequest } from './focus'
import { MoveDialog } from './MoveDialog'
import { blockMinutes, durationText, formatTime } from './time'
import type { Block } from './types'

export interface BlockRowProps {
  block: Block
  tz: string
}

// One block as a row of a list, in "today" and in "week" alike (design language 5.2): the start
// hour, the title, a line of details, and at the end the check button, one press to mark it done.
// Every other action (defer, move, pin) is in the "⋯" menu before it. It is one <li>, so it must
// sit inside a <List>.
export function BlockRow({ block, tz }: BlockRowProps) {
  const { name, available, pending, deferring, start, move } = useBlockControls(block, tz)
  const done = block.state === 'done'
  const extras = available.filter(isExtra)
  // After an action on this block the focus comes back to its check button (focus.ts), not to the
  // menu before it: the ref holds only the check button.
  const checkRef = useRef<HTMLSpanElement>(null)
  useFocusRequest(block.id, checkRef)

  return (
    <ListRow
      leading={<span dir="ltr">{formatTime(block.starts_at, tz)}</span>}
      title={block.task_title}
      done={done}
      subtitle={
        // min-w-0 on the words: a long exam name wraps instead of pushing the badge out.
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words">
            {he.board.meta(block.exam_name, he.board.kinds[block.task_kind], durationText(blockMinutes(block)))}
            {partSuffix(block)}
          </span>
          <StateBadge block={block} />
          {deferring ? <Badge tone="neutral">{he.board.deferring}</Badge> : null}
          {block.pinned ? <PinnedMark /> : null}
        </span>
      }
      trailing={
        <>
          {extras.length > 0 ? <BlockMenu name={name} actions={extras} onAction={start} isDisabled={pending} /> : null}
          {/* Last in the DOM, so at the end of the row. */}
          <span ref={checkRef} className="contents">
            <CheckButton
              isDone={done}
              aria-label={done ? he.board.uncompleteLabel(name) : he.board.completeLabel(name)}
              isDisabled={pending}
              onChange={(next) => {
                start(next ? 'complete' : 'uncomplete')
              }}
            />
          </span>
          <MoveDialog {...move} />
        </>
      }
    />
  )
}
