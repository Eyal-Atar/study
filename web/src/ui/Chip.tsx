import type { ReactNode } from 'react'
import type { IconType } from './icons'
import { cx, ICON_STROKE } from './styles'

export interface ChipProps {
  // gold: XP, with gold-ink on gold-soft. leaf: growth, with brand-strong on brand-soft. Each pair is
  // checked for contrast in theme.test.ts.
  tone: 'gold' | 'leaf'
  icon: IconType
  // What a screen reader says instead of the visible text, when the text alone says too little
  // ("+50 XP"). The visible text is then hidden from it.
  label?: string | undefined
  children: ReactNode
}

const TONES = {
  gold: 'bg-gold-soft text-gold-ink',
  leaf: 'bg-brand-soft text-brand-strong',
} as const

// The .chip of the prototype: a pill with an icon and a short line. It is a statement of
// something that happened, not a control and not a state (that is a Badge).
export function Chip({ tone, icon: Icon, label, children }: ChipProps) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-small font-semibold tabular-nums', TONES[tone])}>
      <Icon aria-hidden="true" size={15} strokeWidth={ICON_STROKE} />
      <span aria-hidden={label === undefined ? undefined : 'true'}>{children}</span>
      {label === undefined ? null : <span className="sr-only">{label}</span>}
    </span>
  )
}
