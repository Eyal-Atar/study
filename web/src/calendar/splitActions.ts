import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useApi } from '../api/ApiContext'
import { ApiError, errorMessage } from '../api/client'
import { meKey, type Me } from '../api/me'
import { boardKey, todayKey, useBoardUserId } from '../board/api'
import { dateIn, dayLabel, formatTime, useProfileTimezone } from '../board/time'
import type { Today } from '../board/types'
import { undoOnce } from '../board/undoOnce'
import { tasksKey } from '../exam/api'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'
import { splitOffersKey, studyDateOf, type SplitOffer, type SplitOffers, type SplitResult } from './splitOffers'

// The banner's split offer (S44): split it (POST /tasks/{id}/split, undone with POST /plan/undo) or
// "Not now" (POST /tasks/{id}/split/dismiss).
//
// The callbacks live on the mutations, not on mutate(), so the toast and its Undo still work once the
// banner row, or the whole screen, is gone.
//
// Their key is not actionKey(): useBlockActions().pending reads `variables.block.id` from every
// mutation under that key, and these carry an offer, not a block.

export interface SplitActions {
  split(offer: SplitOffer): void
  dismiss(offer: SplitOffer): void
  // True while the split of this task is on its way.
  splitting(taskId: string): boolean
}

interface Vars {
  offer: SplitOffer
}

interface DismissContext {
  previous: SplitOffers | undefined
}

export function splitActionKey(userId: string | null) {
  return ['splitAction', userId] as const
}
function splitKey(userId: string | null) {
  return [...splitActionKey(userId), 'split'] as const
}
function dismissKey(userId: string | null) {
  return [...splitActionKey(userId), 'dismiss'] as const
}

function without(data: SplitOffers | undefined, taskId: string): SplitOffers | undefined {
  return data === undefined ? undefined : { ...data, offers: data.offers.filter((o) => o.task_id !== taskId) }
}

export function useSplitActions(): SplitActions {
  const api = useApi()
  const queryClient = useQueryClient()
  const toast = useToast()
  const userId = useBoardUserId()
  const tz = useProfileTimezone()
  const s = en.calendar.side.banner.split
  const offersKey = splitOffersKey(userId)

  // The board holds the offers too (splitOffersKey is under it); the exam's tasks are not under it.
  const settle = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: boardKey(userId) }),
      queryClient.invalidateQueries({ queryKey: tasksKey(userId) }),
    ])
  const fail = (error: unknown) => {
    toast.show({ text: errorMessage(error), tone: 'error' })
  }

  function undo(versionId: string) {
    const request = undoOnce(queryClient, versionId, () => api.post('/plan/undo', { version_id: versionId }))
    if (request === null) return
    request
      .then(
        () => {
          toast.show({ text: s.undone, tone: 'success' })
        },
        // invalid_state (a bite already ran), nothing_to_undo or stale_plan: the code's own text.
        fail,
      )
      .finally(() => {
        void settle()
      })
  }

  // Where the first bite went: the earliest planned block of the answer. Without one, the offer's
  // first part, on its study day.
  function firstBite(result: SplitResult, offer: SplitOffer): { date: string; startsAt: string } | undefined {
    const first = result.blocks
      .filter((b) => b.status === 'planned')
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0]
    if (first !== undefined) return { date: first.study_date, startsAt: first.starts_at }
    const part = offer.parts[0]
    if (part === undefined) return undefined
    return { date: studyDateOf(part.starts_at, queryClient.getQueryData<Me>(meKey(userId)), tz), startsAt: part.starts_at }
  }

  const splitMutation = useMutation<SplitResult, ApiError, Vars>({
    mutationKey: splitKey(userId),
    mutationFn: ({ offer }) => api.post<SplitResult>(`/tasks/${offer.task_id}/split`, { basis: offer.basis }),
    onSuccess: (result, { offer }) => {
      queryClient.setQueryData<SplitOffers>(offersKey, (data) => without(data, offer.task_id))
      const bite = firstBite(result, offer)
      if (bite === undefined) return
      // "Today" is the server's study day (after midnight, before sleep, it is still yesterday's date).
      const today = queryClient.getQueryData<Today>(todayKey(userId))?.date ?? dateIn(tz)
      const versionId = result.version_id
      toast.show({
        text: s.done(offer.parts.length, dayLabel(bite.date, today), formatTime(bite.startsAt, tz)),
        tone: 'success',
        action: {
          label: en.common.undo,
          onAction: () => {
            undo(versionId)
          },
        },
        timeoutMs: UNDO_TIMEOUT_MS,
      })
    },
    onError: (error) => {
      // The refetch in settle has already happened by the time the student reads this.
      if (error instanceof ApiError && error.code === 'stale_plan') {
        toast.show({ text: s.stale, tone: 'info' })
        return
      }
      if (error instanceof ApiError && error.code === 'no_split_offer') {
        toast.show({ text: codeText('no_split_offer'), tone: 'error' })
        return
      }
      fail(error)
    },
    onSettled: settle,
  })

  // Optimistic: the offer leaves at once; only another failure than "no offer" puts it back.
  const dismissMutation = useMutation<undefined, ApiError, Vars, DismissContext>({
    mutationKey: dismissKey(userId),
    mutationFn: ({ offer }) => api.post<undefined>(`/tasks/${offer.task_id}/split/dismiss`),
    onMutate: async ({ offer }) => {
      await queryClient.cancelQueries({ queryKey: offersKey })
      const previous = queryClient.getQueryData<SplitOffers>(offersKey)
      queryClient.setQueryData<SplitOffers>(offersKey, (data) => without(data, offer.task_id))
      return { previous }
    },
    onSuccess: () => {
      toast.show({ text: s.dismissed, tone: 'info' })
    },
    onError: (error, _vars, context) => {
      // The offer is gone already, which is what the student asked for.
      if (error instanceof ApiError && error.code === 'no_split_offer') return
      if (context?.previous !== undefined) queryClient.setQueryData<SplitOffers>(offersKey, context.previous)
      fail(error)
    },
    // The board did not change; only the offers did.
    onSettled: () => queryClient.invalidateQueries({ queryKey: offersKey }),
  })

  const splittingIds = useMutationState({
    filters: { mutationKey: splitKey(userId), status: 'pending' },
    select: (mutation) => (mutation.state.variables as Vars | undefined)?.offer.task_id,
  })
  const splitting = useCallback((taskId: string) => splittingIds.includes(taskId), [splittingIds])

  return {
    split: (offer) => {
      // Read from the mutation cache, not from splittingIds: a second press in the same tick comes
      // before the re-render. A mutation turns pending synchronously inside mutate().
      const running = queryClient.isMutating({
        mutationKey: splitKey(userId),
        predicate: (m) => (m.state.variables as Vars | undefined)?.offer.task_id === offer.task_id,
      })
      if (running > 0) return
      splitMutation.mutate({ offer })
    },
    dismiss: (offer) => {
      dismissMutation.mutate({ offer })
    },
    splitting,
  }
}
