import { useId, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cx } from './styles'

export interface CardProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  // plain: the white card. A state tone (an error, a warning, a success report) takes the border
  // in the state colour and its soft background; the text stays ink, and the heading (`title`)
  // takes the state colour (design language 5.1).
  tone?: 'plain' | 'danger' | 'warning' | 'success'
  // The heading of the card, drawn first, in the colour of the tone. When the card has a `role`
  // (region, group, alert) and no name from the caller, the heading also names it.
  title?: ReactNode | undefined
  // 2 (the default) when the card is a section of the screen; 3 inside a section with its own h2.
  titleLevel?: 2 | 3
}

// ink is a checked pair on every soft background (theme.test.ts); ink-muted is not, so a state
// card holds no muted text.
const TONES = {
  plain: 'border-line bg-surface',
  danger: 'border-danger bg-danger-soft',
  warning: 'border-warning bg-warning-soft',
  success: 'border-success bg-success-soft',
} as const

// Each state colour is a checked pair on its own soft background.
const TITLE_TONES = {
  plain: 'text-ink',
  danger: 'text-danger',
  warning: 'text-warning',
  success: 'text-success',
} as const

// One thing that stands on its own: the next task, a form, a report. Items of the same kind are
// rows of a List, not a pile of cards, and a card never sits inside a card. As in the prototype, a
// card is defined by its line and its 16px corners: it has no shadow.
export function Card({ tone = 'plain', title, titleLevel = 2, className, children, ...rest }: CardProps) {
  const titleId = useId()
  const Heading = titleLevel === 3 ? 'h3' : 'h2'
  // Without a role a <div> cannot carry a name, and a name from the caller wins.
  const named =
    title !== undefined && rest.role !== undefined && rest['aria-label'] === undefined && rest['aria-labelledby'] === undefined
  return (
    <div {...rest} aria-labelledby={named ? titleId : rest['aria-labelledby']} className={cx('rounded-card border p-card text-ink', TONES[tone], className)}>
      {title === undefined ? null : (
        <Heading id={titleId} className={cx('mb-2 text-body font-semibold break-words', TITLE_TONES[tone])}>
          {title}
        </Heading>
      )}
      {children}
    </div>
  )
}
