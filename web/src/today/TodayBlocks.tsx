import type { ReactNode } from 'react'
import { BlockCard } from '../board/BlockCard'
import type { Block } from '../board/types'

export interface TodayBlocksProps {
  title: string
  blocks: Block[]
  tz: string
  // The view switch (list / timeline), next to the heading.
  toolbar?: ReactNode
}

// Today's blocks by start time, every one with its state and actions. With a toolbar the heading
// row stays even when the list is empty, so the switch to the timeline is still there.
export function TodayBlocks({ title, blocks, tz, toolbar }: TodayBlocksProps) {
  if (blocks.length === 0 && toolbar === undefined) return null
  return (
    <section aria-labelledby="today-blocks-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="today-blocks-title" className="text-base font-semibold">
          {title}
        </h2>
        {toolbar}
      </div>
      {blocks.length === 0 ? null : (
        <ol className="space-y-3">
          {blocks.map((block) => (
            <li key={block.id}>
              <BlockCard block={block} tz={tz} variant="full" />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
