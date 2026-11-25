import { useState } from 'react'
import { prefersReducedMotion } from '../ui/reducedMotion'
import { takeBloom } from './bloomPlay'
import { PlantShape } from './GardenScene'

// The full bloom of a closed exam (S33, Task 10): the flower of the garden in the closing sheet and on
// the card of the closed exam. aria-hidden: the sheet's title and the card already say "is in full bloom".
export function BloomSlot({ examId, colorIndex, size }: { examId: string; colorIndex: number; size: number }) {
  // In the initializer: once per mount, so the event is taken exactly once (a concurrent render that React discards would lose it; accepted).
  const [play] = useState(() => takeBloom(examId) && !prefersReducedMotion())
  return (
    <div data-slot="bloom" aria-hidden="true" style={{ width: size }}>
      <svg viewBox="0 0 48 64" className="block h-auto w-full overflow-visible" focusable="false">
        <g transform="translate(24 60)">
          <PlantShape growth="bloom" colorIndex={colorIndex} opening={play} />
        </g>
      </svg>
    </div>
  )
}
