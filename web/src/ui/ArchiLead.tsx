import { useState } from 'react'
import { Archie, type ArchieMood } from '../archie/Archie'
import { cx } from './styles'

export interface ArchiLeadProps {
  mood: ArchieMood
  // What Archi asks or says. It is the heading of the screen, in his own words.
  question: string
  // One sentence of his under the question, beside him.
  context?: string | undefined
  // One paragraph under the whole row, at the full width, for a longer explanation.
  below?: string | undefined
  // 1 on a screen he opens (the default). 2 or 3 where the screen already has its heading.
  headingLevel?: 1 | 2 | 3 | undefined
}

// How wide each cut-out stands beside his question. The cut-outs have different proportions, so
// each gets the width that makes him about as tall as in the binding prototype (104 to 124px in
// docs/design/prototype/all-screens.html): he is the same character at every step, not a bigger
// one where the drawing happens to be wide.
const WIDTHS: Record<ArchieMood, string> = {
  joy: 'w-28',
  wisdom: 'w-37.5',
  intentions: 'w-31.5',
  flow: 'w-35',
  eureka: 'w-30',
  rest: 'w-40',
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

// Read once, when he arrives: the entrance happens only then.
function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
}

// His entrance: a 200ms fade from nothing, from the first frame he is on the page (starting:). A
// browser without @starting-style shows him at once, which is the calm fallback.
const ENTRANCE =
  'motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out motion-safe:starting:opacity-0'

const HEADINGS = { 1: 'h1', 2: 'h2', 3: 'h3' } as const

// Archi leads (audit, guidelines 7 and 8): first Archi and what he asks, and under this only the
// controls that answer him. He stands straight on the surface, at the bottom of the row, so
// whatever comes next (the answer card, or the line of `below`) is the ground under his feet: the
// component has no space of its own under it.
// The question is on the page at once, in his handwriting (font-display from 24px only: here 34px,
// the .q of the prototype). Only Archi himself fades in, and never for someone who asked the
// system for less motion.
export function ArchiLead({ mood, question, context, below, headingLevel = 1 }: ArchiLeadProps) {
  const [enters] = useState(() => !prefersReducedMotion())
  const Heading = HEADINGS[headingLevel]
  return (
    <div>
      <div className="flex items-end gap-3">
        {/* A new mood is a new arrival: the key lets him fade in again. */}
        <div
          key={mood}
          data-part="archi"
          data-entering={enters ? '' : undefined}
          className={cx('max-w-[45%] shrink-0', WIDTHS[mood], enters && ENTRANCE)}
        >
          {/* Always at the top of its screen, so it loads with the page and not lazily. */}
          <Archie mood={mood} size="card" eager />
        </div>
        <div className="min-w-0 flex-1 pb-3">
          <Heading className="font-display text-[2.125rem] leading-none font-bold tracking-[0.01em] text-balance break-words text-ink">
            {question}
          </Heading>
          {context === undefined ? null : <p className="mt-1.5 text-body text-ink-muted">{context}</p>}
        </div>
      </div>
      {below === undefined ? null : <p className="border-t border-line pt-2 pb-2.5 text-body text-ink-muted">{below}</p>}
    </div>
  )
}
