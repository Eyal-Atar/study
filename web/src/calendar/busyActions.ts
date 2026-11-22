import { useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { useApi } from '../api/ApiContext'
import { ApiError, errorMessage } from '../api/client'
import { useCreateBusyEvent, useDeleteBusyEvent, useUpdateBusyEvent } from '../availability/api'
import type { BusyEventInput, BusyEventPatch, BusyEventWriteResponse, BusyItem } from '../availability/types'
import { boardKey, useBoardUserId } from '../board/api'
import { useOfferReplan } from '../board/offerReplan'
import { undoOnce } from '../board/undoOnce'
import { en } from '../i18n/en'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'

// Writes of busy time (S32). The promises are handled here, not in mutate()'s callbacks, so the
// toast and its Undo come even when the sheet that started the write is gone.

export interface BusyWriteOptions {
  // After the success toast.
  onSuccess(): void
  // After a failure. True means the caller shows the error itself, so no toast.
  onError(error: ApiError): boolean
}

export interface BusyWrite {
  create(input: BusyEventInput, options: BusyWriteOptions): void
  update(id: string, patch: BusyEventPatch, options: BusyWriteOptions): void
  remove(item: BusyItem): void
  // Events deleted on screen whose DELETE has not been sent yet (the Undo window).
  hidden: ReadonlySet<string>
  pending: boolean
}

// Module level, so every part of the calendar sees the same hidden events.
let hiddenIds: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function setHidden(next: ReadonlySet<string>) {
  hiddenIds = next
  for (const listener of listeners) listener()
}
function hide(id: string) {
  setHidden(new Set([...hiddenIds, id]))
}
function unhide(id: string) {
  setHidden(new Set([...hiddenIds].filter((value) => value !== id)))
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useHiddenBusy(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => hiddenIds,
    () => hiddenIds,
  )
}

function distinctTasks(response: BusyEventWriteResponse): number {
  return new Set(response.blocks.map((block) => block.task_id)).size
}

export function useBusyWrite(): BusyWrite {
  const api = useApi()
  const queryClient = useQueryClient()
  const userId = useBoardUserId()
  const toast = useToast()
  const offerReplan = useOfferReplan()
  const createMutation = useCreateBusyEvent()
  const updateMutation = useUpdateBusyEvent()
  const deleteMutation = useDeleteBusyEvent()
  const hidden = useHiddenBusy()
  const b = en.calendar.sheets.busy

  function fail(error: unknown) {
    toast.show({ text: errorMessage(error), tone: 'error' })
  }

  function undo(versionId: string) {
    const request = undoOnce(queryClient, versionId, () => api.post('/plan/undo', { version_id: versionId }))
    if (request === null) return
    request
      .then(
        () => {
          toast.show({ text: b.undone, tone: 'success' })
        },
        fail,
      )
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: boardKey(userId) })
      })
  }

  function saved(response: BusyEventWriteResponse, edited: boolean) {
    let text: string
    if (response.unplaced.length > 0) text = b.savedUnplaced(response.unplaced.length)
    else if (response.blocks.length > 0) text = b.savedMoved(distinctTasks(response))
    else text = edited ? b.updated : b.saved
    const versionId = response.version_id
    if (versionId === null) {
      toast.show({ text, tone: 'success' })
    } else {
      toast.show({
        text,
        tone: 'success',
        action: {
          label: en.common.undo,
          onAction: () => {
            undo(versionId)
          },
        },
        timeoutMs: UNDO_TIMEOUT_MS,
      })
    }
    if (response.unplaced.length > 0) offerReplan()
  }

  function settle(request: Promise<BusyEventWriteResponse>, edited: boolean, options: BusyWriteOptions) {
    request.then(
      (response) => {
        saved(response, edited)
        options.onSuccess()
      },
      (error: unknown) => {
        if (error instanceof ApiError && options.onError(error)) return
        fail(error)
      },
    )
  }

  return {
    create(input, options) {
      settle(createMutation.mutateAsync(input), false, options)
    },
    update(id, patch, options) {
      settle(updateMutation.mutateAsync({ id, patch }), true, options)
    },
    remove(item) {
      hide(item.id)
      toast.show({
        text: b.deleted,
        tone: 'success',
        action: {
          label: en.common.undo,
          onAction: () => {
            unhide(item.id)
          },
        },
        timeoutMs: UNDO_TIMEOUT_MS,
        onExpire: () => {
          deleteMutation
            .mutateAsync(item.id)
            .catch(fail)
            .finally(() => {
              unhide(item.id)
            })
        },
      })
    },
    hidden,
    pending: createMutation.isPending || updateMutation.isPending,
  }
}
