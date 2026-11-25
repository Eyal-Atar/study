import type { Today } from '../board/types'
import { canFocus, focusClock, type FocusSession } from './focusSession'

// The state of the focus screen (FocusPage.tsx), pure, apart from the screen so it can be tested
// alone (a file of components exports only components).

export type FocusView =
  | 'loading'
  | 'error'
  | 'gone'
  | 'alreadyDone'
  | 'five'
  | 'full'
  | 'over'
  | 'ended'
  | 'notToday'
  | 'break'
  // Our own Done without a break: the screen is on its way to the calendar.
  | 'leaving'

export interface FocusViewInput {
  // Set by our own Done (decision 12): it wins over whatever the cache says of the block afterwards.
  finished: 'break' | 'leaving' | null
  today: { isPending: boolean; isError: boolean; data: Today | undefined }
  blockId: string
  // The user's one session, of any block.
  session: FocusSession | null
  now: number
}

// What the screen shows, in the order of the plan's table (Task 4, section 2).
export function focusView({ finished, today, blockId, session, now }: FocusViewInput): FocusView {
  if (finished !== null) return finished
  if (today.isPending) return 'loading'
  if (today.isError || today.data === undefined) return 'error'
  const block = today.data.blocks.find((b) => b.id === blockId)
  if (block === undefined || (block.status !== 'planned' && block.status !== 'done')) return 'gone'
  if (block.status === 'done') return 'alreadyDone'
  if (session !== null && session.blockId === blockId) return focusClock(session, now).phase
  if (canFocus(block, today.data.date, now)) return 'full'
  if (Date.parse(block.ends_at) <= now) return 'ended'
  return 'notToday'
}
