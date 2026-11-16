import { useRef } from 'react'
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { useBlockActions, type BlockActions } from './actions'
import { actionsFor, type BlockAction } from './actionsFor'
import { blockName } from './blockName'
import { useFocusRequest } from './focus'
import { blockMinutes, durationText, formatRange } from './time'
import type { Block } from './types'

function run(actions: BlockActions, block: Block, action: BlockAction) {
  switch (action) {
    case 'complete':
      actions.complete(block)
      return
    case 'uncomplete':
      actions.uncomplete(block)
      return
    case 'defer':
      actions.defer(block)
      return
    case 'pin':
      actions.setPinned(block, true)
      return
    case 'unpin':
      actions.setPinned(block, false)
  }
}

// `deferring` only while this card's own defer is pending: `pending(id)` is true for any action on
// the block, and a pending complete must not read "דוחה…".
function label(action: BlockAction, deferring: boolean): string {
  if (action === 'defer' && deferring) return he.board.deferring
  return he.board[action]
}

function ariaLabel(action: BlockAction, name: string): string {
  const labels = {
    complete: he.board.completeLabel,
    uncomplete: he.board.uncompleteLabel,
    defer: he.board.deferLabel,
    pin: he.board.pinLabel,
    unpin: he.board.unpinLabel,
  } as const
  return labels[action](name)
}

const STATE_BADGE = {
  in_progress: 'bg-brand-soft text-brand-strong',
  overdue: 'bg-warning-soft text-warning',
  done: 'bg-success-soft text-success',
  missed: 'bg-surface-muted text-ink-muted',
  skipped: 'bg-surface-muted text-ink-muted',
} as const

export interface BlockCardProps {
  block: Block
  tz: string
  // full: every action as a button (today). compact: one row and a "פעולות" menu (week).
  variant?: 'full' | 'compact'
}

export function BlockCard({ block, tz, variant = 'full' }: BlockCardProps) {
  const actions = useBlockActions()
  const pending = actions.pending(block.id)
  // Only a defer of this block says "דוחה…", whichever screen or toast started it.
  const deferring = actions.deferring(block.id)
  const start = (action: BlockAction) => {
    run(actions, block, action)
  }
  const available = actionsFor(block)
  const done = block.state === 'done'
  const badge = block.state === 'upcoming' ? null : block.state
  const titleId = `block-${block.id}-title`
  // The buttons' names; the article keeps the plain title (aria-labelledby).
  const name = blockName(block)
  // After an action on this block, the focus comes back to this card's first button (focus.ts).
  const ref = useRef<HTMLElement>(null)
  useFocusRequest(block.id, ref)

  const meta = (
    <p className="text-sm text-ink-muted">
      <span dir="ltr" className="tabular-nums">
        {formatRange(block, tz)}
      </span>
      {' · '}
      {durationText(blockMinutes(block))}
      {' · '}
      {block.exam_name}
      {' · '}
      {he.board.kinds[block.task_kind]}
      {block.part_count > 1 ? ` · ${he.board.part(block.part_index, block.part_count)}` : null}
    </p>
  )

  const tags =
    badge !== null || block.pinned ? (
      <div className="flex flex-wrap gap-2">
        {badge === null ? null : (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_BADGE[badge]}`}>{he.board.states[badge]}</span>
        )}
        {block.pinned ? (
          <span className="rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink-muted">{he.board.pinned}</span>
        ) : null}
      </div>
    ) : null

  const title = (
    <h3 id={titleId} className={`font-semibold ${done ? 'text-ink-muted line-through' : ''}`}>
      {block.task_title}
    </h3>
  )

  if (variant === 'compact') {
    return (
      <article ref={ref} aria-labelledby={titleId} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-surface p-3">
        <div className="min-w-0 space-y-1">
          {title}
          {meta}
          {tags}
        </div>
        <MenuTrigger>
          <Button variant="secondary" aria-label={he.board.actionsLabel(name)} isDisabled={pending} className="shrink-0">
            {deferring ? he.board.deferring : he.board.actions}
          </Button>
          <Popover placement="bottom end" className="min-w-40 rounded-lg border border-line bg-surface p-1 shadow-lg">
            <Menu
              aria-label={he.board.actionsLabel(name)}
              className="outline-none"
              onAction={(key) => {
                start(key as BlockAction)
              }}
            >
              {available.map((action) => (
                <MenuItem
                  key={action}
                  id={action}
                  className="min-h-11 cursor-pointer rounded-md px-3 py-2 text-sm outline-none data-[focused]:bg-surface-muted"
                >
                  {he.board[action]}
                </MenuItem>
              ))}
            </Menu>
          </Popover>
        </MenuTrigger>
      </article>
    )
  }

  return (
    <article ref={ref} aria-labelledby={titleId} className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="space-y-1">
        {title}
        {meta}
        {tags}
      </div>
      <div className="flex flex-wrap gap-2">
        {available.map((action) => (
          <Button
            key={action}
            variant={action === 'complete' ? 'primary' : 'secondary'}
            aria-label={ariaLabel(action, name)}
            isDisabled={pending}
            onPress={() => {
              start(action)
            }}
          >
            {label(action, deferring)}
          </Button>
        ))}
      </div>
    </article>
  )
}
