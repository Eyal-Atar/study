import type { ComponentPropsWithoutRef } from 'react'
import { cx } from './styles'

export interface CardProps extends ComponentPropsWithoutRef<'div'> {
  // plain: the white card. A state tone (an error, a warning, a success report) takes the border
  // in the state colour and its soft background; the text stays ink, and the caller gives the
  // heading the state colour (design language 5.1).
  tone?: 'plain' | 'danger' | 'warning' | 'success'
}

// ink is a checked pair on every soft background (theme.test.ts); ink-muted is not, so a state
// card holds no muted text.
const TONES = {
  plain: 'border-line bg-surface',
  danger: 'border-danger bg-danger-soft',
  warning: 'border-warning bg-warning-soft',
  success: 'border-success bg-success-soft',
} as const

// One thing that stands on its own: the next task, a form, a report. Items of the same kind are
// rows of a List, not a pile of cards, and a card never sits inside a card. A card is defined by
// its line: it has no shadow.
export function Card({ tone = 'plain', className, ...rest }: CardProps) {
  return <div {...rest} className={cx('rounded-card border p-card text-ink', TONES[tone], className)} />
}
