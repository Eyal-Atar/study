import type { ReactNode } from 'react'
import { cx } from './styles'

export interface BadgeProps {
  // brand: "עכשיו". success: "בוצע". warning: "עבר הזמן". neutral: "הוחמץ", "דולג".
  // There is no danger tone on purpose: a task that was not done is never red.
  tone: 'brand' | 'success' | 'warning' | 'neutral'
  children: ReactNode
}

// Each pair is checked for contrast in theme.test.ts (brand on brand-soft is not, hence strong).
const TONES = {
  brand: 'bg-brand-soft text-brand-strong',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  neutral: 'bg-surface-muted text-ink-muted',
} as const

// A badge is for a state, and always has words: colour alone carries nothing. What is not a state
// (the name of the exam, "נעול") is text in the subtitle of the row (design language 5.5).
// A pill, like the chips of the prototype, with a medium label. It is always one line. In a place narrower than its words (the end of a row on a phone) it is
// cut with an ellipsis instead of widening what holds it: max-w-full needs a block box, hence
// inline-block, and align-middle keeps it on the line of the text beside it.
export function Badge({ tone, children }: BadgeProps) {
  return (
    <span className={cx('inline-block max-w-full truncate rounded-full px-2.5 align-middle text-small font-medium', TONES[tone])}>
      {children}
    </span>
  )
}
