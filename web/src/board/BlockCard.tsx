import { BlockRow } from './BlockRow'
import type { Block } from './types'

export interface BlockCardProps {
  block: Block
  tz: string
  // Ignored: both variants are the same row since S27.
  variant?: 'full' | 'compact'
}

// A temporary shim, so that today/TodayBlocks and week/WeekDay keep compiling until S27 Tasks 4
// and 7 move them to BlockRow. Task 8 deletes this file.
export function BlockCard({ block, tz }: BlockCardProps) {
  return <BlockRow block={block} tz={tz} />
}
