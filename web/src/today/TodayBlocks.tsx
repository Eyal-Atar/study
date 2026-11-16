import { BlockCard } from '../board/BlockCard'
import type { Block } from '../board/types'

export interface TodayBlocksProps {
  title: string
  blocks: Block[]
  tz: string
}

// Today's blocks by start time, every one with its state and actions.
export function TodayBlocks({ title, blocks, tz }: TodayBlocksProps) {
  if (blocks.length === 0) return null
  return (
    <section aria-labelledby="today-blocks-title" className="space-y-3">
      <h2 id="today-blocks-title" className="text-base font-semibold">
        {title}
      </h2>
      <ol className="space-y-3">
        {blocks.map((block) => (
          <li key={block.id}>
            <BlockCard block={block} tz={tz} variant="full" />
          </li>
        ))}
      </ol>
    </section>
  )
}
