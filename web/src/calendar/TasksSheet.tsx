import { useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { blockMinutes, durationText } from '../board/time'
import type { Block, Today } from '../board/types'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { CalendarClock, FreeTimeIcon } from '../ui/icons'
import { cx, FOCUS_RING, ICON_STROKE } from '../ui/styles'
import { TodayTasks } from './TodayTasks'

export interface TasksSheetProps {
  todayData: Today
  tz: string
  onFreeTime: () => void
  onMarkBusy: () => void
  onOpenBlock: (block: Block) => void
}

const counts = (block: Block) => block.state !== 'missed' && block.state !== 'skipped'

// The bar above the bottom navigation on a phone (the .peek of the prototype), and the sheet it
// opens: today's blocks, then the two ways to change the day. The bar says what is left; the sheet
// is the same list as the side panel's.
export function TasksSheet({ todayData, tz, onFreeTime, onMarkBusy, onOpenBlock }: TasksSheetProps) {
  const [open, setOpen] = useState(false)
  const counted = todayData.blocks.filter(counts)
  const left = counted.filter((block) => block.status === 'planned')
  const minutes = left.reduce((sum, block) => sum + blockMinutes(block), 0)
  const then = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  return (
    <>
      <div className="fixed inset-x-2 bottom-[calc(var(--spacing-bottombar)+env(safe-area-inset-bottom)+6px)] z-30 rounded-sheet bg-surface shadow-sheet">
        <AriaButton
          onPress={() => {
            setOpen(true)
          }}
          className={cx('flex min-h-touch w-full cursor-pointer flex-col items-stretch rounded-sheet px-4 pt-2 pb-2.5 text-start', FOCUS_RING)}
        >
          <span aria-hidden="true" className="mx-auto mb-2 h-1 w-9 rounded-full bg-line" />
          <span className="flex items-baseline justify-between gap-3">
            <span className="font-semibold">{en.today.blocks}</span>
            {/* A day with no block is not "all done": the end of the bar says nothing then. */}
            {counted.length === 0 ? null : (
              <span className="text-small text-ink-muted tabular-nums">{en.calendar.side.peekLeft(left.length, durationText(minutes))}</span>
            )}
          </span>
        </AriaButton>
      </div>
      <Dialog title={en.today.blocks} isOpen={open} onOpenChange={setOpen}>
        <div className="flex flex-col gap-4">
          <TodayTasks blocks={counted} tz={tz} onOpenBlock={(block) => {
              setOpen(false)
              onOpenBlock(block)
            }} />
          <div className="flex flex-col gap-2">
            <Button variant="secondary" className="w-full" onPress={then(onFreeTime)}>
              <FreeTimeIcon size={18} className="text-brand-strong" />
              {en.calendar.side.freeTime}
            </Button>
            <Button variant="secondary" className="w-full" onPress={then(onMarkBusy)}>
              <CalendarClock aria-hidden="true" size={18} strokeWidth={ICON_STROKE} className="text-ink-muted" />
              {en.calendar.side.markBusy}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
