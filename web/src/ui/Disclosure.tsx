import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, Disclosure as AriaDisclosure, DisclosurePanel } from 'react-aria-components'
import { cx, FOCUS_RING, ICON_STROKE } from './styles'

export interface DisclosureProps {
  // The text of the button that opens the note.
  label: string
  children: ReactNode
  defaultExpanded?: boolean
}

// A collapsed note under the button that opens it: the reason of a task, the evidence of a topic.
// For a short text that most people do not need; anything that has to be read is not hidden here.
// React Aria gives the button aria-expanded and aria-controls, and the panel is hidden with
// hidden="until-found", so the browser's find-in-page still reaches the text and opens it.
// The trigger is not wrapped in a Heading (React Aria's examples do): a note inside a row of a
// list is not a section of the page, and a heading per row would flood the outline.
export function Disclosure({ label, children, defaultExpanded = false }: DisclosureProps) {
  return (
    <AriaDisclosure defaultExpanded={defaultExpanded} className="flex flex-col items-start">
      <Button
        slot="trigger"
        className={cx(
          'group inline-flex min-h-touch cursor-pointer items-center gap-1 rounded-control text-small font-semibold text-brand',
          'transition-colors duration-(--duration-fast) data-[hovered]:text-brand-strong',
          FOCUS_RING,
        )}
      >
        <ChevronDown
          aria-hidden="true"
          size={18}
          strokeWidth={ICON_STROKE}
          className="transition-transform group-aria-expanded:rotate-180"
        />
        {label}
      </Button>
      {/* The look sits on an inner element: a panel hidden with until-found keeps its own box, so
          padding or a fill on the panel itself would show while it is closed. */}
      <DisclosurePanel>
        <div className="rounded-control bg-surface-muted px-3 py-2 text-small break-words text-ink">{children}</div>
      </DisclosurePanel>
    </AriaDisclosure>
  )
}
