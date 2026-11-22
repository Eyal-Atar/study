import { useQueryClient } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import { ApiError, errorMessage } from '../api/client'
import { useFreeTime } from '../availability/api'
import { boardKey, useBoardUserId } from '../board/api'
import { formatRange, useProfileTimezone } from '../board/time'
import { undoOnce } from '../board/undoOnce'
import { en } from '../i18n/en'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'

export interface FreeTimeOptions {
  onSuccess(): void
  // True means the caller shows the error itself, so no toast.
  onError(error: ApiError): boolean
}

export interface FreeTimeWrite {
  start(minutes: number, options: FreeTimeOptions): void
  pending: boolean
}

// "I have time now". Handled on the promise, so the toast and Undo outlive the sheet.
export function useFreeTimeWrite(): FreeTimeWrite {
  const api = useApi()
  const queryClient = useQueryClient()
  const userId = useBoardUserId()
  const tz = useProfileTimezone()
  const toast = useToast()
  const mutation = useFreeTime()
  const f = en.calendar.sheets.freeTime

  function fail(error: unknown) {
    toast.show({ text: errorMessage(error), tone: 'error' })
  }

  function undo(versionId: string) {
    const request = undoOnce(queryClient, versionId, () => api.post('/plan/undo', { version_id: versionId }))
    if (request === null) return
    request
      .then(
        () => {
          toast.show({ text: f.undone, tone: 'success' })
        },
        fail,
      )
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: boardKey(userId) })
      })
  }

  return {
    start(minutes, options) {
      mutation.mutateAsync(minutes).then(
        (result) => {
          const text = f.done(
            result.placed_task_ids.length,
            formatRange({ starts_at: result.session_starts_at, ends_at: result.session_ends_at }, tz),
          )
          const versionId = result.version_id
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
          options.onSuccess()
        },
        (error: unknown) => {
          if (error instanceof ApiError && options.onError(error)) return
          fail(error)
        },
      )
    },
    pending: mutation.isPending,
  }
}
