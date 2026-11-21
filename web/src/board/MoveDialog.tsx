import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useApi } from '../api/ApiContext'
import type { ApiError } from '../api/client'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Note } from '../ui/Note'
import { OptionGrid } from '../ui/OptionGrid'
import { ErrorState, LoadingState } from '../ui/states'
import { boardKey, useBoardUserId } from './api'
import { blockName } from './blockName'
import { useMoveBlock } from './move'
import { formatRange, formatTime } from './time'
import type { Block, Slots } from './types'

export interface MoveDialogProps {
  block: Block
  tz: string
  isOpen: boolean
  onClose: () => void
}

// "הזזה" without dragging (S18 decision 10, and spec 7.9: every gesture has a visible button): the
// times on the local 15-minute grid the block can move to on its own day, from the server, as a
// grid to choose from. Works in "week" for any day.
// The dialog is a form: "הזזה" submits it. The times and the buttons are two children of ui/Dialog,
// which mounts them only while it is open, so every opening asks the server anew. Both read the
// same query; the chosen time lives here, where the submit is.
export function MoveDialog({ block, tz, isOpen, onClose }: MoveDialogProps) {
  const { move } = useMoveBlock()
  const [chosen, setChosen] = useState<string | null>(null)

  // Every way out forgets the choice: this component stays mounted between openings.
  function close() {
    setChosen(null)
    onClose()
  }

  return (
    <Dialog
      title={en.move.dialogTitle(blockName(block))}
      description={en.move.dialogLead}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      onSubmit={() => {
        if (chosen === null) return
        close()
        move(block, chosen)
      }}
      footer={<MoveActions blockId={block.id} chosen={chosen} onCancel={close} />}
    >
      <MoveSlots block={block} tz={tz} chosen={chosen} onChoose={setChosen} />
    </Dialog>
  )
}

function useSlots(blockId: string) {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<Slots, ApiError>({
    // Under the board: any action on the board makes the answer stale.
    queryKey: [...boardKey(userId), 'slots', blockId],
    queryFn: ({ signal }) => api.get<Slots>(`/blocks/${blockId}/slots`, { signal }),
    enabled: userId !== null,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

function MoveSlots({
  block,
  tz,
  chosen,
  onChoose,
}: {
  block: Block
  tz: string
  chosen: string | null
  onChoose: (slot: string | null) => void
}) {
  const slots = useSlots(block.id)
  const list = slots.data?.slots ?? []

  return (
    <>
      <p className="text-small text-ink">
        {en.move.current}
        <span dir="ltr" className="font-semibold tabular-nums">
          {formatRange(block, tz)}
        </span>
      </p>

      {slots.isPending ? <LoadingState shape="text" rows={2} label={en.move.loading} /> : null}

      {slots.isError ? (
        <ErrorState
          message={en.move.loadFailed}
          onRetry={() => {
            void slots.refetch()
          }}
        />
      ) : null}

      {slots.isSuccess && list.length === 0 ? <Note>{en.move.empty}</Note> : null}

      {slots.isSuccess && list.length > 0 ? (
        <OptionGrid
          aria-label={en.move.slotsLabel}
          options={list.map((slot) => ({ id: slot, label: formatTime(slot, tz) }))}
          value={chosen}
          // Pressing the chosen time again gives null: nothing is chosen, and "הזזה" is disabled.
          onChange={onChoose}
          ltr
        />
      ) : null}
    </>
  )
}

// "הזזה" exists only when there is a time to choose, and is disabled until one is chosen.
function MoveActions({ blockId, chosen, onCancel }: { blockId: string; chosen: string | null; onCancel: () => void }) {
  // The query of MoveSlots, read a second time: both mount together, so it is one request.
  const slots = useSlots(blockId)
  const canMove = slots.isSuccess && slots.data.slots.length > 0
  return (
    <>
      {canMove ? (
        <Button type="submit" className="flex-1" isDisabled={chosen === null}>
          {en.move.confirm}
        </Button>
      ) : null}
      <Button variant="secondary" onPress={onCancel}>
        {en.common.cancel}
      </Button>
    </>
  )
}
