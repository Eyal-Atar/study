import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Dialog, Heading, ListBox, ListBoxItem, Modal, ModalOverlay, type Key } from 'react-aria-components'
import { useApi } from '../api/ApiContext'
import type { ApiError } from '../api/client'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
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
// list to choose from. Works in "week" for any day. The content mounts only while open, so every
// opening asks the server anew.
export function MoveDialog({ block, tz, isOpen, onClose }: MoveDialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      isDismissable
      className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4"
    >
      <Modal className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-6 shadow-xl outline-none sm:rounded-2xl">
        <Dialog className="outline-none">
          <MoveContent block={block} tz={tz} onClose={onClose} />
        </Dialog>
      </Modal>
    </ModalOverlay>
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

function MoveContent({ block, tz, onClose }: { block: Block; tz: string; onClose: () => void }) {
  const slots = useSlots(block.id)
  const { move } = useMoveBlock()
  const [chosen, setChosen] = useState<string | null>(null)
  const list = slots.data?.slots ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <Heading slot="title" className="text-xl font-bold">
          {he.move.dialogTitle(blockName(block))}
        </Heading>
        <p className="text-ink-muted">{he.move.dialogLead}</p>
        <p className="text-sm text-ink-muted">
          {he.move.current}
          <span dir="ltr" className="tabular-nums">
            {formatRange(block, tz)}
          </span>
        </p>
      </div>

      {slots.isPending ? (
        <p role="status" className="text-ink-muted">
          {he.move.loading}
        </p>
      ) : null}

      {slots.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-danger">
            {he.move.loadFailed}
          </p>
          <Button
            variant="secondary"
            onPress={() => {
              void slots.refetch()
            }}
          >
            {he.common.retry}
          </Button>
        </div>
      ) : null}

      {slots.isSuccess && list.length === 0 ? <p className="rounded-lg bg-surface-muted px-3 py-2">{he.move.empty}</p> : null}

      {slots.isSuccess && list.length > 0 ? (
        <ListBox
          aria-label={he.move.slotsLabel}
          layout="grid"
          selectionMode="single"
          selectedKeys={chosen === null ? [] : [chosen]}
          onSelectionChange={(keys) => {
            if (keys === 'all') return
            const [first] = [...keys] as Key[]
            setChosen(first === undefined ? null : String(first))
          }}
          className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto p-1 outline-none sm:grid-cols-4"
        >
          {list.map((slot) => {
            const time = formatTime(slot, tz)
            return (
              <ListBoxItem
                key={slot}
                id={slot}
                textValue={time}
                className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line-strong bg-surface text-sm font-medium tabular-nums outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-brand data-[hovered]:bg-surface-muted data-[selected]:border-brand data-[selected]:bg-brand data-[selected]:text-on-brand"
              >
                <span dir="ltr">{time}</span>
              </ListBoxItem>
            )
          })}
        </ListBox>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-2">
        {slots.isSuccess && list.length > 0 ? (
          <Button
            isDisabled={chosen === null}
            onPress={() => {
              if (chosen === null) return
              onClose()
              move(block, chosen)
            }}
          >
            {he.move.confirm}
          </Button>
        ) : null}
        <Button variant="secondary" onPress={onClose}>
          {he.common.cancel}
        </Button>
      </div>
    </div>
  )
}
