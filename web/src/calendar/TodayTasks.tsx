import { useId, useRef } from 'react'
import { Button } from 'react-aria-components'
import { useBlockActions } from '../board/actions'
import { blockName } from '../board/blockName'
import { useFocusRequest } from '../board/focus'
import { blockMinutes, durationText, formatTime } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { sortByStart } from '../today/chooseNext'
import { CheckButton } from '../ui/CheckButton'
import { examColor } from '../ui/examColor'
import { KIND_ICON } from '../ui/icons'
import { SectionHeading } from '../ui/SectionHeading'
import { cx, ICON_STROKE } from '../ui/styles'
import { UserText } from '../ui/UserText'

export interface TodayTasksProps {
  // The blocks to show, in any order: the list sorts them by their start.
  blocks: Block[]
  tz: string
  heading?: string | undefined
  onOpenBlock: (block: Block) => void
}

// One block of the day (the .task of the prototype): the stripe of its exam, when it starts, its
// name, and the check. The body and the check are two buttons side by side, never one inside the
// other: the body opens the block's actions, the check marks it.
function TaskRow({ block, tz, onOpenBlock }: { block: Block; tz: string; onOpenBlock: (block: Block) => void }) {
  const actions = useBlockActions()
  const name = blockName(block)
  const isDone = block.state === 'done'
  const color = examColor(block.exam_color_index)
  const KindIcon = KIND_ICON[block.task_kind]
  // After its check was pressed the focus stays with the block's row (board/focus.ts).
  const rowRef = useRef<HTMLLIElement>(null)
  useFocusRequest(block.id, rowRef)
  return (
    // The row clips its stripe to its corners; the check sits 4px from the end, so its ring fits.
    <li ref={rowRef} className="flex min-h-[54px] items-center overflow-hidden rounded-control bg-canvas pe-1">
      <span aria-hidden="true" className={cx('w-1 shrink-0 self-stretch', color.solid)} />
      <Button
        aria-label={en.board.actionsLabel(name)}
        onPress={() => {
          onOpenBlock(block)
        }}
        // The row clips what is drawn outside it, so the ring of the body is drawn inside it.
        className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 self-stretch py-2 ps-2.5 text-start outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[focus-visible]:ring-inset"
      >
        <span className="w-[38px] shrink-0 text-small font-semibold tabular-nums">{formatTime(block.starts_at, tz)}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <UserText
            truncate
            className={isDone ? 'text-ink-muted line-through' : 'font-semibold group-data-[hovered]:underline'}
          >
            {block.task_title}
          </UserText>
          <span className="flex items-center gap-1 text-caption whitespace-nowrap text-ink-muted">
            <KindIcon aria-hidden="true" size={14} strokeWidth={ICON_STROKE} className={cx('shrink-0', color.text)} />
            {en.board.kinds[block.task_kind]}
            {en.calendar.side.joiner}
            {durationText(blockMinutes(block))}
          </span>
        </span>
      </Button>
      <CheckButton
        isDone={isDone}
        isDisabled={actions.pending(block.id)}
        aria-label={isDone ? en.board.uncompleteLabel(name) : en.board.completeLabel(name)}
        onChange={(done) => {
          if (done) actions.complete(block)
          else actions.uncomplete(block)
        }}
      />
    </li>
  )
}

// The blocks of the day as a list of rows. With nothing to show there is nothing at all, not even
// the heading.
export function TodayTasks({ blocks, tz, heading, onOpenBlock }: TodayTasksProps) {
  const headingId = useId()
  if (blocks.length === 0) return null
  return (
    <div>
      {heading === undefined ? null : (
        <SectionHeading id={headingId} level={3} className="mb-2">
          {heading}
        </SectionHeading>
      )}
      <ul aria-labelledby={heading === undefined ? undefined : headingId} className="flex flex-col gap-1.5">
        {sortByStart(blocks).map((block) => (
          <TaskRow key={block.id} block={block} tz={tz} onOpenBlock={onOpenBlock} />
        ))}
      </ul>
    </div>
  )
}
