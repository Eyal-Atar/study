// The one place of the calendar's sheets: at most one is open at a time, and opening another
// replaces it (the actions sheet's Defer becomes the defer sheet, never a dialog over a dialog).
//
// The closure sheet of S45 is one of them (the seam S32 left, now built): `{ kind: 'closure' }` opens
// ClosureSheet on GET /closures' `pending`, from the banner's row or by itself (CalendarPage). Its
// question counts as shown on this device when it shows (markShown), not when it is asked for. A
// decision takes the banner's row (its opener) away, so when the sheet closes and the dialog has
// nowhere to give the focus back, it goes to the heading above the banner (`focusAfter`, below).
//
// The celebration sheet of S33 is one too: `{ kind: 'celebration' }` opens CelebrationSheet when a Done
// of this session earned a moment (CalendarPage pulls it from the inbox when no sheet is open, after
// a closure that opens by itself). It opened by itself, so its opener may be gone: the focus falls
// back to the same heading.
import { useEffect, useRef, type RefObject } from 'react'
import type { BusyItem } from '../availability/types'
import { useBoardUserId } from '../board/api'
import type { Block } from '../board/types'
import { CelebrationSheet } from '../celebrate/CelebrationSheet'
import type { Celebration } from '../celebrate/rules'
import { ClosureSheet } from '../closure/ClosureSheet'
import { markShown } from '../closure/seen'
import type { ClosureItem } from '../closure/types'
import type { Progress } from '../progress/types'
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
  | { kind: 'celebration'; celebration: Celebration }
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
  // The celebration sheet: GET /progress, today's blocks and tomorrow's first planned block.
  progress: Progress | undefined
  todayBlocks: Block[]
  tomorrowFirst: Block | null
}

export function CalendarSheets({
  sheet,
  setSheet,
  setGhosts,
  blocks,
  upcoming,
  tz,
  today,
  now,
  pending,
  focusAfter,
  progress,
  todayBlocks,
  tomorrowFirst,
}: CalendarSheetsProps) {
  const userId = useBoardUserId()
  // The closure or the celebration sheet has closed (its X, a decision, or by itself when its exam
  // left pending; the celebration opened by itself, after its opener may have gone). React
  // Aria gives the focus back to the opener in a frame it asks for as the dialog unmounts, during
  // that commit; this effect runs after it, so its frame comes after that one. If the opener left
  // (the banner's row goes with a decision) the focus is on the body, and goes to the heading.
  const lastKind = useRef(sheet?.kind)
  useEffect(() => {
    const was = lastKind.current
    lastKind.current = sheet?.kind
    if ((was !== 'closure' && was !== 'celebration') || sheet !== null) return
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === null || document.activeElement === document.body) focusAfter.current?.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [sheet, focusAfter])
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
          onClose={close}
          onShown={(item) => {
            if (userId !== null) markShown(userId, item)
          }}
        />
      )
    case 'celebration':
      return (
        <CelebrationSheet
          celebration={sheet.celebration}
          progress={progress}
          todayBlocks={todayBlocks}
          tomorrowFirst={tomorrowFirst}
          tz={tz}
          onClose={close}
        />
      )
  }
}
