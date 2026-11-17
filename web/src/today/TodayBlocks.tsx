import type { ReactNode } from 'react'
import { BlockRow } from '../board/BlockRow'
import type { Block } from '../board/types'
import { List } from '../ui/List'
import { SectionHeading } from '../ui/SectionHeading'

export interface TodayBlocksProps {
  title: string
  blocks: Block[]
  tz: string
  // The view switch (list / timeline), next to the heading.
  toolbar?: ReactNode
}

// Today's blocks by start time, one row each (design language 5.2). With a toolbar the heading
// row stays even when the list is empty, so the switch to the timeline is still there.
export function TodayBlocks({ title, blocks, tz, toolbar }: TodayBlocksProps) {
  if (blocks.length === 0 && toolbar === undefined) return null
  return (
    <section aria-labelledby="today-blocks-title" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading id="today-blocks-title">{title}</SectionHeading>
        {toolbar}
      </div>
      {blocks.length === 0 ? null : (
        // The line above the first row closes the list at the top, as each row closes it below.
        <List aria-label={title} className="border-t border-line">
          {blocks.map((block) => (
            <BlockRow key={block.id} block={block} tz={tz} />
          ))}
        </List>
      )}
    </section>
  )
}
