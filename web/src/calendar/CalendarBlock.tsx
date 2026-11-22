import type { CSSProperties, DOMAttributes, KeyboardEvent, MouseEvent } from 'react'
import { useBlockActions } from '../board/actions'
import { blockName } from '../board/blockName'
import { formatRange } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { BlockCheck } from '../ui/BlockCheck'
import { examColor } from '../ui/examColor'
import { KIND_ICON, Lock, MoveVertical } from '../ui/icons'
import { cx, FOCUS_RING_NATIVE } from '../ui/styles'
import { UserText } from '../ui/UserText'
import type { CalendarView } from './calendarUrl'
import { titleLines } from './geometry'

// The one element of the grid that holds the keyboard instructions; every block points at it.
export const GRID_INSTRUCTIONS_ID = 'calendar-grid-instructions'

// The week is narrow and dense, the day is wide: the sizes of the prototype's .blk and .ph .blk.
// `title` keeps the name clear of the check's square. In the week it keeps only the square clear,
// since a column is about 130px wide; in the day it keeps the whole 44px of the check clear.
const LOOK = {
  week: {
    text: 'text-[12px] leading-[15px]',
    meta: 'text-[11px] leading-[14px]',
    icon: 14,
    indent: 'ps-[19px]',
    gutter: 'w-[14px]',
    title: 'pe-[27px]',
    square: '[&>span]:me-[6px]',
    squareTop: '[&>span]:mt-[3px]',
    // Under this height a line of text and the padding do not fit: the line is centred instead.
    compact: 25,
  },
  day: {
    text: 'text-[13.5px] leading-[17px]',
    meta: 'text-[12px] leading-[15px]',
    icon: 16,
    indent: 'ps-[21px]',
    gutter: 'w-[16px]',
    title: 'pe-[44px]',
    square: '[&>span]:me-[8px]',
    squareTop: '[&>span]:mt-[4px]',
    compact: 27,
  },
} as const

const STATE_TEXT = {
  in_progress: en.board.states.in_progress,
  overdue: en.board.states.overdue,
  done: en.board.states.done,
} as const

function stateOf(block: Block): string | null {
  return block.state === 'in_progress' || block.state === 'overdue' || block.state === 'done' ? STATE_TEXT[block.state] : null
}

// A press that began on a control inside the block (the check) is that control's, not the block's.
function fromInnerControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest('button') !== null
}

// The gestures of the grid (Task 8, useBlockDrag and useSwipe), laid on the block by TimeGrid.
export type BlockGestures = Pick<
  DOMAttributes<HTMLDivElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onKeyDown' | 'onBlur'
>

export interface CalendarBlockProps {
  block: Block
  tz: string
  view: CalendarView
  top: number
  height: number
  onOpen: (block: Block) => void
  // Held by a drag: raised above the grid.
  lifted?: boolean
  // About to be moved by a change that is still a preview (new busy time over it).
  leaving?: boolean
  style?: CSSProperties
  gestures?: BlockGestures
}

// A study block on the grid (decision 4, audit guideline 13): the colour says which exam, the icon
// at the start says which kind of work, and the check at the end marks it done. Nothing is
// transparent: a done block is muted and struck through, an overdue one is outlined in dashes.
//
// A div with role="button" and not a <button>: the check inside it is a button.
export function CalendarBlock({ block, tz, view, top, height, onOpen, lifted = false, leaving = false, style, gestures }: CalendarBlockProps) {
  const actions = useBlockActions()
  const color = examColor(block.exam_color_index)
  const look = LOOK[view]
  const name = blockName(block)
  const range = formatRange(block, tz)
  const done = block.status === 'done'
  const overdue = block.state === 'overdue'
  const state = stateOf(block)
  const KindIcon = KIND_ICON[block.task_kind]

  const fit = titleLines(height, view)
  // "Will move" must be seen: in a block with room for two lines it takes the second.
  const showMeta = fit.meta || (leaving && height >= 38)
  const twoLines = fit.lines === 2 && !(leaving && !fit.meta)
  const compact = height < look.compact

  // The day has room for the kind, the hours, the state and the lock in words. A week's column
  // does not: there the state takes the place of the hours, which the block's position already
  // says, and the lock is its icon alone. The accessible name carries all of it either way.
  const stateWord = block.state === 'in_progress' ? STATE_TEXT.in_progress : overdue ? STATE_TEXT.overdue : null
  const metaText = leaving
    ? en.calendar.grid.ghostLeaving
    : view === 'day'
      ? en.calendar.grid.meta(en.board.kinds[block.task_kind], range) +
        (stateWord === null ? '' : en.calendar.grid.metaState(stateWord)) +
        (block.pinned ? en.calendar.grid.metaLocked : '')
      : (stateWord ?? range)
  const MetaIcon = leaving ? MoveVertical : block.pinned ? Lock : null

  const titleLook = cx('flex-1', done ? 'font-normal text-ink-muted line-through' : 'font-semibold text-ink')

  function open(event: MouseEvent<HTMLDivElement>) {
    if (fromInnerControl(event.target)) return
    onOpen(block)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // A key the move took (an arrow, or Enter while moving) is not a press on the block.
    gestures?.onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen(block)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={en.calendar.grid.blockLabel(name, range, block.exam_name, en.board.kinds[block.task_kind], state, block.pinned)}
      aria-describedby={GRID_INSTRUCTIONS_ID}
      data-block-id={block.id}
      {...(lifted ? { 'data-lifted': '' } : {})}
      {...gestures}
      onClick={open}
      onKeyDown={onKeyDown}
      style={{ top, height, ...style }}
      className={cx(
        // pan-y: a finger scrolls the day over a block, and a sideways one is the block's (Task 8).
        'calendar-block absolute inset-x-[3px] cursor-pointer touch-pan-y select-none overflow-hidden rounded-[10px] border border-s-4 border-s-current ps-[7px] pe-0',
        'transition-colors duration-(--duration-base) motion-reduce:transition-none',
        look.text,
        // The colour of the exam is the block's currentColor: the stripe, the icon and the check's square.
        color.text,
        compact ? 'flex flex-col justify-center py-0' : 'py-1',
        done ? 'bg-surface-muted' : overdue ? 'bg-surface' : color.soft,
        leaving ? color.borderStrong : done ? 'border-line' : color.line,
        (leaving || overdue) && 'border-dashed',
        // A leaving block lies under the ghost of what pushes it out, so it is raised above the ghosts.
        lifted ? 'z-10 shadow-lift' : leaving ? 'z-30' : 'z-[1]',
        FOCUS_RING_NATIVE,
      )}
    >
      <div className={cx('flex items-start gap-[5px]', look.title)}>
        <KindIcon size={look.icon} aria-hidden className="shrink-0" />
        {twoLines ? (
          <UserText as="span" className={cx('calendar-title-2', titleLook)}>
            {block.task_title}
          </UserText>
        ) : (
          <UserText truncate className={titleLook}>
            {block.task_title}
          </UserText>
        )}
        {/* Last in the row, and laid over the end of the block for its whole height: 44px wide, and
            44px high wherever the block is. The square stays on the title's line, by the edge. */}
        <BlockCheck
          isDone={done}
          onChange={(next) => {
            if (next) actions.complete(block)
            else actions.uncomplete(block)
          }}
          aria-label={done ? en.board.uncompleteLabel(name) : en.board.completeLabel(name)}
          isDisabled={actions.pending(block.id)}
          dataId={block.id}
          className={cx(
            'absolute inset-y-0 end-0 [&>span]:ms-auto',
            // The block clips what is drawn outside the check, so its focus ring is drawn inside it.
            'data-[focus-visible]:ring-inset data-[focus-visible]:ring-offset-0',
            look.square,
            !compact && '[&>span]:self-start',
            !compact && look.squareTop,
          )}
        />
      </div>
      {showMeta ? (
        <div className={cx('mt-0.5 flex items-center gap-[5px]', look.meta, done ? 'text-ink-muted' : 'text-ink', MetaIcon === null && look.indent)}>
          {MetaIcon === null ? null : (
            <span className={cx('flex shrink-0 justify-center', look.gutter)}>
              <MetaIcon size={14} aria-hidden />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate tabular-nums">{metaText}</span>
        </div>
      ) : null}
    </div>
  )
}
