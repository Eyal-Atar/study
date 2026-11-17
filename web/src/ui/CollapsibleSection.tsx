import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button, Disclosure, DisclosurePanel, Heading } from 'react-aria-components'
import { cx, FOCUS_RING, ICON_STROKE } from './styles'

export interface CollapsibleSectionProps {
  // The heading of the section (an h2), which is also the button that opens it.
  title: string
  // What is inside, in a few words, shown at the end of the heading row while the section is
  // closed and open: "3 קבצים".
  summary?: string | undefined
  // Controlled: the screen decides when the section opens by itself (something in it needs the
  // user), and remembers what the user chose.
  isExpanded: boolean
  onExpandedChange: (isExpanded: boolean) => void
  // 2 (the default): a section of the screen. 3: a part of a section that has its own h2.
  level?: 2 | 3
  // The anchor of the section, for a link from another screen.
  id?: string | undefined
  children: ReactNode
}

// A secondary section of a busy screen, closed until it is asked for, so a phone does not show
// everything at once (the materials and the analysis of an exam). Unlike Disclosure, which is a
// small note inside a row, this is a section of the page: its trigger is inside an h2, so the
// outline of the screen lists it, and it is as wide as the screen with a line above it.
// React Aria gives the button aria-expanded and aria-controls, and hides the panel with
// hidden="until-found": the content stays in the DOM, and find-in-page opens it.
// A section that holds something the user has to act on must not stay closed: the caller opens it.
export function CollapsibleSection({ title, summary, isExpanded, onExpandedChange, level = 2, id, children }: CollapsibleSectionProps) {
  return (
    <Disclosure id={id} isExpanded={isExpanded} onExpandedChange={onExpandedChange} className="scroll-mt-4 border-t border-line">
      <Heading level={level}>
        <Button
          slot="trigger"
          className={cx(
            'group flex min-h-14 w-full cursor-pointer items-center gap-2 rounded-control text-start',
            'transition-colors duration-(--duration-fast) data-[hovered]:bg-surface-muted',
            FOCUS_RING,
          )}
        >
          <span className="min-w-0 flex-1 text-body font-semibold break-words text-ink">{title}</span>
          {/* The space is for the accessible name, which joins the two texts: "חומרים 3 קבצים". */}
          {summary === undefined ? null : <span className="shrink-0 text-small font-normal text-ink-muted"> {summary}</span>}
          <ChevronDown
            aria-hidden="true"
            size={18}
            strokeWidth={ICON_STROKE}
            className="shrink-0 text-ink-muted transition-transform group-aria-expanded:rotate-180"
          />
        </Button>
      </Heading>
      {/* The padding sits on an inner element: a panel hidden with until-found keeps its own box. */}
      <DisclosurePanel>
        <div className="pt-2 pb-4">{children}</div>
      </DisclosurePanel>
    </Disclosure>
  )
}
