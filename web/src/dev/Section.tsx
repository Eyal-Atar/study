import type { ReactNode } from 'react'
import { cx } from '../ui/styles'
import { SECTIONS, type SectionId } from './devText'

// One component of the catalogue: a region named by its h2. The h2 is a label and not a headline
// (design language 3): small, semibold, muted. The id is the target of the table of contents.
export function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = SECTIONS.find((section) => section.id === id)?.title
  const headingId = `${id}-title`
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-4 space-y-4 border-t border-line pt-4">
      <h2 id={headingId} className="text-small font-semibold text-ink-muted">
        {title}
      </h2>
      {children}
    </section>
  )
}

// One state of a component, with a caption that names it. min-w-0: an example inside a grid may
// shrink below a long word instead of widening the page.
export function Example({ caption, className, children }: { caption: string; className?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-small text-ink-muted">{caption}</p>
      <div className={cx('min-w-0', className)}>{children}</div>
    </div>
  )
}

// Controls side by side, wrapping on a narrow screen.
export const ROW = 'flex flex-wrap items-center gap-2'
// Fields: one column on a phone, two from md.
export const FIELD_GRID = 'grid gap-4 md:grid-cols-2'
