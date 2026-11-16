import type { Block } from '../board/types'

// "The next task" (decision 1 of the S14 plan). An overdue block is never the next one: the server
// does not defer a block that ended, and it waits in today's list for the morning review (S18).

function byStart(a: Block, b: Block): number {
  return Date.parse(a.starts_at) - Date.parse(b.starts_at)
}

export function sortByStart(blocks: Block[]): Block[] {
  return [...blocks].sort(byStart)
}

// Today's block in progress, else today's first upcoming block.
export function nextToday(blocks: Block[]): Block | undefined {
  const sorted = sortByStart(blocks)
  return sorted.find((b) => b.state === 'in_progress') ?? sorted.find((b) => b.state === 'upcoming')
}

// The first upcoming block of a day after `today`, by the server's study_date.
export function nextLater(blocks: Block[], today: string): Block | undefined {
  return sortByStart(blocks).find((b) => b.study_date > today && b.state === 'upcoming')
}
