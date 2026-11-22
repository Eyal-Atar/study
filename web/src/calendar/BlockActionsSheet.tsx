import { useState } from 'react'
import { useBlockActions } from '../board/actions'
import { actionsFor } from '../board/actionsFor'
import { blockName } from '../board/blockName'
import { MoveDialog } from '../board/MoveDialog'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { BlockCard } from './BlockCard'

export interface BlockActionsSheetProps {
  block: Block | null
  tz: string
  onClose: () => void
  onDefer: (block: Block) => void
}

// What a block can do, as buttons: every gesture of the grid has one here. Open while `block` is set.
// Each action closes the sheet; Move closes it only after the move dialog is closed, so the sheet
// steps aside (it is not open under the dialog) while the times are chosen.
export function BlockActionsSheet({ block, tz, onClose, onDefer }: BlockActionsSheetProps) {
  const actions = useBlockActions()
  const [moving, setMoving] = useState(false)
  if (block === null) return null
  const name = blockName(block)
  const allowed = actionsFor(block)

  function then(run: () => void) {
    run()
    onClose()
  }

  return (
    <>
      <Dialog
        title={en.calendar.sheets.actions.title}
        isOpen={!moving}
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
      >
        <BlockCard block={block} tz={tz} />
        <div className="flex flex-col gap-2">
          {allowed.includes('complete') ? (
            <Button
              variant="primary"
              className="w-full"
              aria-label={en.board.completeLabel(name)}
              onPress={() => {
                then(() => {
                  actions.complete(block)
                })
              }}
            >
              {en.board.complete}
            </Button>
          ) : null}
          {allowed.includes('uncomplete') ? (
            <Button
              variant="secondary"
              className="w-full"
              aria-label={en.board.uncompleteLabel(name)}
              onPress={() => {
                then(() => {
                  actions.uncomplete(block)
                })
              }}
            >
              {en.board.uncomplete}
            </Button>
          ) : null}
          {allowed.includes('defer') ? (
            <Button
              variant="secondary"
              className="w-full"
              aria-label={en.board.deferLabel(name)}
              onPress={() => {
                onDefer(block)
              }}
            >
              {en.board.defer}
            </Button>
          ) : null}
          {allowed.includes('move') ? (
            <Button
              variant="secondary"
              className="w-full"
              aria-label={en.move.moveLabel(name)}
              onPress={() => {
                setMoving(true)
              }}
            >
              {en.move.move}
            </Button>
          ) : null}
          {allowed.includes('pin') || allowed.includes('unpin') ? (
            <Button
              variant="secondary"
              className="w-full"
              aria-label={block.pinned ? en.board.unpinLabel(name) : en.board.pinLabel(name)}
              onPress={() => {
                then(() => {
                  actions.setPinned(block, !block.pinned)
                })
              }}
            >
              {block.pinned ? en.board.unpin : en.board.pin}
            </Button>
          ) : null}
          {block.state === 'done' ? null : (
            <>
              <Button
                variant="danger"
                className="w-full"
                aria-label={en.review.skipLabel(name)}
                onPress={() => {
                  then(() => {
                    actions.skip(block)
                  })
                }}
              >
                {en.review.skip}
              </Button>
              <p className="text-small text-ink-muted">{en.calendar.sheets.actions.skipHint}</p>
            </>
          )}
        </div>
      </Dialog>
      <MoveDialog
        block={block}
        tz={tz}
        isOpen={moving}
        onClose={() => {
          setMoving(false)
          onClose()
        }}
      />
    </>
  )
}
