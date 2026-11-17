import { CalendarClock, Ellipsis, Lock, LockOpen, MoveVertical, type LucideIcon } from 'lucide-react'
import { he } from '../i18n/he'
import { Badge } from '../ui/Badge'
import { IconButton } from '../ui/IconButton'
import { Menu, MenuItem } from '../ui/Menu'
import { ICON_STROKE } from '../ui/styles'
import { actionLabel, type ExtraAction } from './blockControls'
import type { Block } from './types'

// The pieces the row of a block (BlockRow) and the "next" card (today/NextBlock) both draw: the
// "⋯" menu, the state badge and the pinned mark. What they share that is not a component (running
// an action, the words and the names) is in blockControls.ts.

const MENU_ICONS: Record<ExtraAction, LucideIcon> = {
  defer: CalendarClock,
  move: MoveVertical,
  pin: Lock,
  unpin: LockOpen,
}

export interface BlockMenuProps {
  name: string
  actions: readonly ExtraAction[]
  onAction: (action: ExtraAction) => void
  isDisabled: boolean
  // quiet in a row; secondary next to the buttons of the "next" card.
  variant?: 'quiet' | 'secondary'
}

// The "⋯" menu of a block. The menu takes its name from the button that opens it.
export function BlockMenu({ name, actions, onAction, isDisabled, variant = 'quiet' }: BlockMenuProps) {
  return (
    <Menu
      trigger={
        <IconButton aria-label={he.board.actionsLabel(name)} variant={variant} isDisabled={isDisabled}>
          <Ellipsis aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        </IconButton>
      }
    >
      {actions.map((action) => (
        <MenuItem
          key={action}
          id={action}
          icon={MENU_ICONS[action]}
          onAction={() => {
            onAction(action)
          }}
        >
          {actionLabel(action)}
        </MenuItem>
      ))}
    </Menu>
  )
}

const STATE_TONE = {
  in_progress: 'brand',
  overdue: 'warning',
  missed: 'neutral',
  skipped: 'neutral',
} as const

// The badge of the block's state. An upcoming block has none, and neither has a done one: the
// check and the struck title already say it (S27 decision 5).
export function StateBadge({ block }: { block: Block }) {
  if (block.state === 'upcoming' || block.state === 'done') return null
  return <Badge tone={STATE_TONE[block.state]}>{he.board.states[block.state]}</Badge>
}

// "Pinned" is not a state, so it is no badge: a small lock and the word, in the line of details
// (design language 5.5).
export function PinnedMark() {
  return (
    <span className="inline-flex items-center gap-1 align-middle whitespace-nowrap">
      <Lock aria-hidden="true" size={14} strokeWidth={ICON_STROKE} />
      {he.board.pinned}
    </span>
  )
}
