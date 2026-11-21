import { useState } from 'react'
import { en } from '../i18n/en'
import { useBlockActions, type BlockActions } from './actions'
import { actionsFor, type BlockAction } from './actionsFor'
import { blockName } from './blockName'
import type { MoveDialogProps } from './MoveDialog'
import type { Block } from './types'

// What the row of a block (BlockRow) and the "next" card (today/NextBlock) share that is not a
// component: running an action, the words and the accessible names. The components they share
// are in blockParts.tsx (a file of components exports nothing else, for fast refresh).

// The actions that are never the check button or the "בוצע" button: they go into the menu.
export type ExtraAction = Exclude<BlockAction, 'complete' | 'uncomplete'>

export function isExtra(action: BlockAction): action is ExtraAction {
  return action !== 'complete' && action !== 'uncomplete'
}

// "move" opens MoveDialog, so useBlockControls handles it itself.
function run(actions: BlockActions, block: Block, action: Exclude<BlockAction, 'move'>) {
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

// The plain word of an action: the text of a button or of a menu item.
export function actionLabel(action: BlockAction): string {
  return action === 'move' ? en.move.move : en.board[action]
}

// The name of a button: the action with the block's name, since the button repeats on the screen.
export function actionAriaLabel(action: BlockAction, name: string): string {
  const labels = {
    complete: en.board.completeLabel,
    uncomplete: en.board.uncompleteLabel,
    defer: en.board.deferLabel,
    move: en.move.moveLabel,
    pin: en.board.pinLabel,
    unpin: en.board.unpinLabel,
  } as const
  return labels[action](name)
}

export interface BlockControls {
  // The name every control of the block uses: the title, and the part of a split task.
  name: string
  available: BlockAction[]
  // True while any action on the block is on its way: every control of the block is disabled.
  pending: boolean
  // True only while a defer of this block is pending, whichever screen or toast started it:
  // `pending` covers every action, and a pending complete must not read "דוחה…".
  deferring: boolean
  start: (action: BlockAction) => void
  // The props of the block's <MoveDialog>, which "move" opens. The caller draws it: the dialog
  // shows nothing until then, so it can sit anywhere inside the caller.
  move: MoveDialogProps
}

export function useBlockControls(block: Block, tz: string): BlockControls {
  const actions = useBlockActions()
  const [moveOpen, setMoveOpen] = useState(false)
  const start = (action: BlockAction) => {
    if (action === 'move') {
      setMoveOpen(true)
      return
    }
    run(actions, block, action)
  }
  return {
    name: blockName(block),
    available: actionsFor(block),
    pending: actions.pending(block.id),
    deferring: actions.deferring(block.id),
    start,
    move: {
      block,
      tz,
      isOpen: moveOpen,
      onClose: () => {
        setMoveOpen(false)
      },
    },
  }
}

// ". חלק 1 מתוך 2" after the details of a split task, else nothing.
export function partSuffix(block: Pick<Block, 'part_index' | 'part_count'>): string {
  return block.part_count > 1 ? en.board.metaPart(en.board.part(block.part_index, block.part_count)) : ''
}
