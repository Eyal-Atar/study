import { useMutation, useMutationState, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useApi } from '../api/ApiContext'
import { ApiError, errorMessage } from '../api/client'
import { codeText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'
import { useBlockActions } from './actions'
import { boardKey, reviewKey, todayKey, useBoardUserId } from './api'
import { useOfferReplan } from './offerReplan'
import { dateIn, dayLabel, formatTime, useProfileTimezone } from './time'
import type { Block, RescheduleResult, Review, SkipResult, Today } from './types'
import { undoOnce } from './undoOnce'

// The morning review (S18, spec 7.9): planned blocks that ended without a mark, and what to do with
// each one.
//
// "בוצע" is the board's complete (S14), whose undo is uncomplete. It is optimistic on every board
// query, and the review answer is one of them (reviewKey lives under boardKey), so the block turns
// `done` in the review cache at once and the card, which lists only planned blocks, drops it; a
// failure restores it there too. No second optimistic layer is needed.
//
// "העבר" and "דלג" are not optimistic: the planner on the server picks the new place (and may find
// none), and a skip removes the task's open blocks. The undo of both is POST /plan/undo with the
// version they wrote, which also puts the reviewed block back to planned (decision 5).
//
// After every action the whole board (['board', userId]) is refetched.

const REFRESH_MS = 60_000

export function useReview(): UseQueryResult<Review, ApiError> {
  const api = useApi()
  const userId = useBoardUserId()
  return useQuery<Review, ApiError>({
    queryKey: reviewKey(userId),
    queryFn: ({ signal }) => api.get<Review>('/review', { signal }),
    enabled: userId !== null,
    refetchInterval: REFRESH_MS,
  })
}

// For the screen that pressed: told when this one call failed (the card gives the focus back to the
// row). Unlike the mutation's own callbacks, it does not run once that screen is gone.
export interface ReviewCallOptions {
  onError?: () => void
}

export interface ReviewActions {
  complete(block: Block): void
  moveToday(block: Block, options?: ReviewCallOptions): void
  moveNext(block: Block): void
  skip(block: Block, options?: ReviewCallOptions): void
  // True while any action on this block runs, in any screen (or from a toast).
  pending(blockId: string): boolean
  // True while this block is being moved (the button says "מעביר…").
  moving(blockId: string): boolean
}

interface MoveVars {
  block: Block
  todayOnly: boolean
}
interface SkipVars {
  block: Block
}

// What a move remembers before it runs: the task's blocks the board already knew, and today's study day.
interface MoveContext {
  known: Set<string>
  today: string | undefined
}

function reviewActionKey(userId: string | null) {
  return ['reviewAction', userId] as const
}
function moveKey(userId: string | null) {
  return [...reviewActionKey(userId), 'move'] as const
}
function skipKey(userId: string | null) {
  return [...reviewActionKey(userId), 'skip'] as const
}

function hasBlocks(data: unknown): data is { blocks: Block[] } {
  return typeof data === 'object' && data !== null && Array.isArray((data as { blocks?: unknown }).blocks)
}

// Where the task went: place_task writes the missing minutes as new blocks (new ids), so the answer
// is the first planned block the board did not have before.
function movedTo(blocks: Block[], known: Set<string>): Block | undefined {
  return blocks
    .filter((b) => b.status === 'planned' && !known.has(b.id))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0]
}

export function useReviewActions(): ReviewActions {
  const api = useApi()
  const queryClient = useQueryClient()
  const toast = useToast()
  const userId = useBoardUserId()
  const tz = useProfileTimezone()
  const offerReplan = useOfferReplan()
  const blockActions = useBlockActions()
  const key = boardKey(userId)

  const settle = () => queryClient.invalidateQueries({ queryKey: key })
  const fail = (error: unknown) => {
    toast.show({ text: errorMessage(error), tone: 'error' })
  }

  function undoToast(text: string, onUndo: () => void) {
    toast.show({ text, tone: 'success', action: { label: he.common.undo, onAction: onUndo }, timeoutMs: UNDO_TIMEOUT_MS })
  }

  function undoVersion(versionId: string, doneText: string) {
    const request = undoOnce(queryClient, versionId, () => api.post('/plan/undo', { version_id: versionId }))
    if (request === null) return
    request
      .then(
        () => {
          toast.show({ text: doneText, tone: 'success' })
        },
        // nothing_to_undo or stale_plan: another version came in between. The refetch shows the board as it is.
        fail,
      )
      .finally(() => {
        void settle()
      })
  }

  // The callbacks live on the mutation, not on mutate(), so they still run when the screen that
  // started the action is gone (a toast's undo outlives a route change).
  const moveMutation = useMutation<RescheduleResult, ApiError, MoveVars, MoveContext>({
    mutationKey: moveKey(userId),
    mutationFn: ({ block, todayOnly }) => api.post<RescheduleResult>(`/blocks/${block.id}/reschedule`, { today_only: todayOnly }),
    onMutate: ({ block }) => {
      const known = new Set<string>()
      for (const [, data] of queryClient.getQueriesData({ queryKey: key })) {
        if (hasBlocks(data)) for (const b of data.blocks) if (b.task_id === block.task_id) known.add(b.id)
      }
      return { known, today: queryClient.getQueryData<Today>(todayKey(userId))?.date }
    },
    onError: (error, { block }) => {
      if (error instanceof ApiError && error.code === 'placement_failed') {
        const reason = error.details.reason
        if (reason === 'no_time_today') {
          // Nothing changed on the server; the next free place is one press away.
          toast.show({
            text: codeText('no_time_today'),
            tone: 'info',
            action: {
              label: he.review.moveNext,
              onAction: () => {
                moveMutation.mutate({ block, todayOnly: false })
              },
            },
            timeoutMs: UNDO_TIMEOUT_MS,
          })
          return
        }
        const why = typeof reason === 'string' ? `${codeText('placement_failed')} ${unscheduledText(reason)}` : codeText('placement_failed')
        offerReplan(why)
        return
      }
      fail(error)
    },
    onSuccess: (result, _vars, context) => {
      const next = movedTo(result.blocks, context.known)
      // "Today" is the server's study day (after midnight, before sleep, it is still yesterday's date).
      const today = context.today ?? dateIn(tz)
      const text =
        next === undefined ? he.review.movedSomewhere : he.review.moved(dayLabel(next.study_date, today), formatTime(next.starts_at, tz))
      const versionId = result.version_id
      if (versionId === null) {
        toast.show({ text, tone: 'success' })
      } else {
        undoToast(text, () => {
          undoVersion(versionId, he.review.moveUndone)
        })
      }
    },
    onSettled: settle,
  })

  const skipMutation = useMutation<SkipResult, ApiError, SkipVars>({
    mutationKey: skipKey(userId),
    mutationFn: ({ block }) => api.post<SkipResult>(`/blocks/${block.id}/skip`),
    onError: fail,
    onSuccess: (result, { block }) => {
      const text = he.review.skipped(block.task_title)
      const versionId = result.version_id
      if (versionId === null) {
        toast.show({ text, tone: 'success' })
      } else {
        undoToast(text, () => {
          undoVersion(versionId, he.review.skipUndone)
        })
      }
    },
    onSettled: settle,
  })

  const reviewPendingIds = useMutationState({
    filters: { mutationKey: reviewActionKey(userId), status: 'pending' },
    select: (mutation) => (mutation.state.variables as SkipVars | undefined)?.block.id,
  })
  const movingIds = useMutationState({
    filters: { mutationKey: moveKey(userId), status: 'pending' },
    select: (mutation) => (mutation.state.variables as MoveVars | undefined)?.block.id,
  })
  // Not memoized: the board's own pending changes with every render of useBlockActions.
  const pending = (blockId: string) => reviewPendingIds.includes(blockId) || blockActions.pending(blockId)
  const moving = useCallback((blockId: string) => movingIds.includes(blockId), [movingIds])

  return {
    complete: (block) => {
      blockActions.complete(block)
    },
    moveToday: (block, options) => {
      moveMutation.mutate({ block, todayOnly: true }, { onError: options?.onError })
    },
    moveNext: (block) => {
      moveMutation.mutate({ block, todayOnly: false })
    },
    skip: (block, options) => {
      skipMutation.mutate({ block }, { onError: options?.onError })
    },
    pending,
    moving,
  }
}
