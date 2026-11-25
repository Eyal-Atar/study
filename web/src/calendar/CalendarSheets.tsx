// The one place of the calendar's sheets: at most one is open at a time, and opening another
// replaces it (the actions sheet's Defer becomes the defer sheet, never a dialog over a dialog).
//
// The closure sheet of S45 is one of them (the seam S32 left, now built): `{ kind: 'closure' }` opens
// ClosureSheet on GET /closures' `pending`, from the banner's row or by itself (CalendarPage). Its
// question counts as shown on this device when it shows (markShown), not when it is asked for. A
// decision takes the banner's row (its opener) away, so when the sheet closes and the dialog has
// nowhere to give the focus back, it goes to the heading above the banner (`focusAfter`).
import type { RefObject } from 'react'
import type { BusyItem } from '../availability/types'
import { useBoardUserId } from '../board/api'
import type { Block } from '../board/types'
import { ClosureSheet } from '../closure/ClosureSheet'
import { markShown } from '../closure/seen'
import type { ClosureItem } from '../closure/types'
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
  | { kind: 'closure'; examId: string }
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
  // GET /closures pending: the closure sheet's exam, and the next one after a decision.
  pending: ClosureItem[]
  // The heading above the banner.
  focusAfter: RefObject<HTMLElement | null>
}

export function CalendarSheets({ sheet, setSheet, setGhosts, blocks, upcoming, tz, today, now, pending, focusAfter }: CalendarSheetsProps) {
  const userId = useBoardUserId()
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
    case 'closure':
      return (
        <ClosureSheet
          examId={sheet.examId}
          pending={pending}
          onClose={() => {
            close()
            // After the dialog's own return of the focus to its opener, when that is still there:
            // React Aria does it in a frame it asks for as the sheet unmounts, after this handler,
            // so the check waits for the frame after that one.
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (document.activeElement === null || document.activeElement === document.body) focusAfter.current?.focus()
              })
            })
          }}
          onShown={(item) => {
            if (userId !== null) markShown(userId, item)
          }}
        />
      )
  }
}
