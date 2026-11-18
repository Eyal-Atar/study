import type { ReactNode } from 'react'
import { cx } from './styles'

export interface SectionHeadingProps {
  children: ReactNode
  // For aria-labelledby of the section or the list under it.
  id?: string | undefined
  // 2 (the default): a section of the screen, under the h1 of the PageHeader. 3: a part of a section.
  level?: 2 | 3
  className?: string | undefined
}

// The heading of a section of a screen ("עוד היום", "הקבצים"). A section heading is a label and
// not a headline (design language 3): small, medium and muted at both levels, like the headings
// of the prototype's side panel ("המשימות של היום"), so the names of
// the items under it stay the strongest text. The title of the screen is the PageHeader, and the
// heading of a card is the `title` of Card.
export function SectionHeading({ children, id, level = 2, className }: SectionHeadingProps) {
  const Tag = level === 3 ? 'h3' : 'h2'
  return (
    <Tag id={id} className={cx('text-small font-medium text-ink-muted', className)}>
      {children}
    </Tag>
  )
}
