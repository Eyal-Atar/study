import { BlockCard } from '../board/BlockCard'
import type { Block } from '../board/types'
import { he } from '../i18n/he'

export interface NextBlockProps {
  block: Block
  tz: string
  // Set when the block is on a later day: "מחר, 09:00". Today's block already shows its time.
  when?: string
}

// The one card the eye lands on first: what to do now, with its actions.
export function NextBlock({ block, tz, when }: NextBlockProps) {
  return (
    <section aria-labelledby="next-title" className="space-y-3 rounded-2xl bg-brand-soft p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
        <h2 id="next-title" className="text-base font-semibold text-brand-strong">
          {he.today.next}
        </h2>
        {when === undefined ? null : <p className="text-sm font-medium text-brand-strong">{when}</p>}
      </div>
      <BlockCard block={block} tz={tz} variant="full" />
    </section>
  )
}
