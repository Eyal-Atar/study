import type { Block } from './types'

export type BlockAction = 'complete' | 'uncomplete' | 'defer' | 'pin' | 'unpin'

// Which actions a block offers (decision 2 of the S14 plan). An overdue block cannot be deferred:
// the server refuses a block that already ended, which waits for the morning review (S18).
export function actionsFor(block: Block): BlockAction[] {
  switch (block.state) {
    case 'upcoming':
    case 'in_progress':
      return ['complete', 'defer', block.pinned ? 'unpin' : 'pin']
    case 'overdue':
    case 'missed':
    case 'skipped':
      return ['complete']
    case 'done':
      return ['uncomplete']
  }
}
