import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useBlockActions } from '../board/actions'
import { actionsFor } from '../board/actionsFor'
import { useBoardUserId } from '../board/api'
import { blockName } from '../board/blockName'
import { MoveDialog } from '../board/MoveDialog'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { useReadOnly } from '../offline/useReadOnly'
import {
  canFocus,
  canStartFive,
  clearSession,
  focusPath,
  isLive,
  useFocusSession,
  useStartFocus,
} from '../session/focusSession'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { BlockCard } from './BlockCard'

export interface BlockActionsSheetProps {
  block: Block | null
  tz: string
  today: string
  now: number
  onClose: () => void
  onDefer: (block: Block) => void
}

// What a block can do, as buttons: every gesture of the grid has one here. Open while `block` is set.
// Start now, Just 5 minutes and Back to focus (S42) come first for a block of today that has not ended;
// then Done is a secondary button, so the sheet keeps one primary.
// Each action closes the sheet; Move closes it only after the move dialog is closed, so the sheet
// steps aside (it is not open under the dialog) while the times are chosen.
// Without a network (S38) the sheet only shows the block: every action is disabled and says why, and
// only Back to focus (a session already on this device) stays. It reads useReadOnly itself, as
// FocusPage does: CalendarSheets, which opens it, passes no read-only state down.
export function BlockActionsSheet({ block, tz, today, now, onClose, onDefer }: BlockActionsSheetProps) {
  const actions = useBlockActions()
  const session = useFocusSession()
  const startFocus = useStartFocus()
  const navigate = useNavigate()
  const userId = useBoardUserId()
  const [moving, setMoving] = useState(false)
  const readOnly = useReadOnly()
  if (block === null) return null
  const name = blockName(block)
  const allowed = actionsFor(block)
  const focus = canFocus(block, today, now)
  const live = focus && isLive(session, block.id, now)

  function then(run: () => void) {
    run()
    onClose()
  }

  // Done or Skip here ends the block's timer too: an Undo brings the block back, not the session (M7).
  function endFocus() {
    if (live && userId !== null) clearSession(userId)
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
        {readOnly ? <p className="text-small text-ink-muted">{en.offline.blockOnly}</p> : null}
        <div className="flex flex-col gap-2">
          {focus && live ? (
            <Button
              variant="primary"
              className="w-full"
              onPress={() => {
                // Straight to the screen: it shows the session as it is now, also one that just ran out (M2).
                then(() => {
                  void navigate(focusPath(block.id))
                })
              }}
            >
              {en.focus.resume}
            </Button>
          ) : null}
          {focus && !live ? (
            <>
              <Button
                isDisabled={readOnly}
                variant="primary"
                className="w-full"
                aria-label={en.focus.startLabel(name)}
                onPress={() => {
                  then(() => {
                    startFocus(block, 'full')
                  })
                }}
              >
                {en.focus.start}
              </Button>
              {canStartFive(block, now) ? (
                <Button
                  isDisabled={readOnly}
                  variant="secondary"
                  className="w-full"
                  aria-label={en.focus.fiveLabel(name)}
                  onPress={() => {
                    then(() => {
                      startFocus(block, 'five')
                    })
                  }}
                >
                  {en.focus.five}
                </Button>
              ) : null}
            </>
          ) : null}
          {allowed.includes('complete') ? (
            <Button
              isDisabled={readOnly}
              variant={focus ? 'secondary' : 'primary'}
              className="w-full"
              aria-label={en.board.completeLabel(name)}
              onPress={() => {
                then(() => {
                  endFocus()
                  actions.complete(block)
                })
              }}
            >
              {en.board.complete}
            </Button>
          ) : null}
          {allowed.includes('uncomplete') ? (
            <Button
              isDisabled={readOnly}
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
              isDisabled={readOnly}
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
              isDisabled={readOnly}
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
              isDisabled={readOnly}
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
                isDisabled={readOnly}
                variant="danger"
                className="w-full"
                aria-label={en.review.skipLabel(name)}
                onPress={() => {
                  then(() => {
                    endFocus()
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
