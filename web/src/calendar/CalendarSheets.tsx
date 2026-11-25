// The one place of the calendar's sheets: at most one is open at a time, and opening another
// replaces it (the actions sheet's Defer becomes the defer sheet, never a dialog over a dialog).
//
// The seam for S45 (the exam-closure sheet: GET /closures, POST /exams/{id}/close, /moed-b): add
// `| { kind: 'closure'; examId: string }` to SheetState and one branch to the switch below, and let
// CalendarPage open it (setSheet) when GET /closures has an item. No new state in the screen.
import type { BusyItem } from '../availability/types'
import type { Block } from '../board/types'
import { BlockActionsSheet } from './BlockActionsSheet'
import { BusySheet } from './BusySheet'
import { CommitmentSheet } from './CommitmentSheet'
import { DeferSheet } from './DeferSheet'
import { FreeTimeSheet } from './FreeTimeSheet'
import type { Ghost } from './ghost'

export type SheetState =
  | { kind: 'block'; block: Block }
  | { kind: 'defer'; block: Block }
  | { kind: 'freeTime' }
  | { kind: 'busyNew'; draft: { date: string; startsAt: string; endsAt: string } }
  | { kind: 'busyEdit'; item: BusyItem }
  | { kind: 'commitment'; item: BusyItem }
  | null

export interface CalendarSheetsProps {
  sheet: SheetState
  setSheet: (sheet: SheetState) => void
  setGhosts: (ghosts: Ghost[]) => void
  blocks: Block[]
  // The planned blocks that have not started yet, in start order (the free-time sheet).
  upcoming: Block[]
  tz: string
  today: string
  now: number
}

export function CalendarSheets({ sheet, setSheet, setGhosts, blocks, upcoming, tz, today, now }: CalendarSheetsProps) {
  // Every close leaves no ghost behind (Review Focus 6), whichever way the sheet was closed.
  const close = () => {
    setGhosts([])
    setSheet(null)
  }
  if (sheet === null) return null
  switch (sheet.kind) {
    case 'block':
      return (
        <BlockActionsSheet
          block={sheet.block}
          tz={tz}
          today={today}
          now={now}
          onClose={close}
          onDefer={(block) => {
            setSheet({ kind: 'defer', block })
          }}
        />
      )
    case 'defer':
      return <DeferSheet block={sheet.block} tz={tz} today={today} onClose={close} onPreview={setGhosts} />
    case 'freeTime':
      return <FreeTimeSheet isOpen upcoming={upcoming} now={now} today={today} tz={tz} onClose={close} onPreview={setGhosts} />
    case 'busyNew':
      return <BusySheet draft={sheet.draft} event={null} blocks={blocks} tz={tz} today={today} onClose={close} onPreview={setGhosts} />
    case 'busyEdit':
      return <BusySheet draft={null} event={sheet.item} blocks={blocks} tz={tz} today={today} onClose={close} onPreview={setGhosts} />
    case 'commitment':
      return <CommitmentSheet item={sheet.item} tz={tz} onClose={close} />
  }
}
