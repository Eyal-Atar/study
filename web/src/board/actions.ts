import { useMutation, useMutationState, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useApi } from '../api/ApiContext'
import { ApiError, errorMessage } from '../api/client'
import { codeText, unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'
import { boardKey, todayKey, useBoardUserId } from './api'
import { useOfferReplan } from './offerReplan'
import { dateIn, dayLabel, formatTime, useProfileTimezone } from './time'
import type { Block, BlockState, CompleteResult, DeferResult, Today } from './types'

// The actions on one block, shared by "today" and "week".
//
// complete, uncomplete and pin are optimistic: their result is known (one block's status or pinned),
// so every board query in the cache (today and every plan range) shows it at once. A failure puts
// the snapshot taken before back, with a toast. Their undo is the opposite action (spec 7.6 step 8:
// they create no plan version).
//
// defer is not optimistic: the planner on the server picks the new place, and may find none. The
// button shows "דוחה…" until the answer; the undo is POST /plan/undo with the version it created.
//
// After every action the whole board (['board', userId]) is refetched.

export interface BlockActions {
  complete(block: Block): void
  uncomplete(block: Block): void
  defer(block: Block): void
  setPinned(block: Block, pinned: boolean): void
  // True while an action on this block is running, in any screen.
  pending(blockId: string): boolean
  // True while this block is being deferred (the button says "דוחה…").
  deferring(blockId: string): boolean
}

interface Vars {
  block: Block
  pinned?: boolean
}

type Snapshot = [QueryKey, unknown][]

function actionKey(userId: string | null) {
  return ['blockAction', userId] as const
}
function deferKey(userId: string | null) {
  return [...actionKey(userId), 'defer'] as const
}

// What defer remembers before it runs: the task's blocks it already knew, and today's study day.
interface DeferContext {
  known: Set<string>
  today: string | undefined
}

function hasBlocks(data: unknown): data is { blocks: Block[] } {
  return typeof data === 'object' && data !== null && Array.isArray((data as { blocks?: unknown }).blocks)
}

// A planned block's state by the clock, as the server derives it (plan_views.block_state).
function plannedState(block: Block, now: number = Date.now()): BlockState {
  if (Date.parse(block.ends_at) <= now) return 'overdue'
  if (Date.parse(block.starts_at) <= now) return 'in_progress'
  return 'upcoming'
}

// Where a deferred task went: place_task keeps the task's other blocks where they are and writes
// the released minutes as new blocks (new ids), so the answer is the first planned block the board
// did not have before. None (the board did not show the task's blocks) → say it moved, not where.
function movedTo(blocks: Block[], known: Set<string>): Block | undefined {
  return blocks
    .filter((b) => b.status === 'planned' && !known.has(b.id))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0]
}

export function useBlockActions(): BlockActions {
  const api = useApi()
  const queryClient = useQueryClient()
  const toast = useToast()
  const userId = useBoardUserId()
  const tz = useProfileTimezone()
  const offerReplan = useOfferReplan()
  const key = boardKey(userId)
  const mutationKey = actionKey(userId)

  const settle = () => queryClient.invalidateQueries({ queryKey: key })
  const fail = (error: unknown) => {
    toast.show({ text: errorMessage(error), tone: 'error' })
  }

  async function patchBlock(id: string, patch: (block: Block) => Block): Promise<Snapshot> {
    await queryClient.cancelQueries({ queryKey: key })
    const snapshot = queryClient.getQueriesData({ queryKey: key })
    queryClient.setQueriesData({ queryKey: key }, (data: unknown) =>
      hasBlocks(data) ? { ...data, blocks: data.blocks.map((b) => (b.id === id ? patch(b) : b)) } : data,
    )
    return snapshot
  }

  // Put back only this block, as the snapshot had it: another action, or a refetch that landed in
  // between, may have changed the rest of the board since, and that stays.
  function restore(id: string, snapshot: Snapshot | undefined) {
    for (const [queryKey, saved] of snapshot ?? []) {
      if (!hasBlocks(saved)) continue
      const before = saved.blocks.find((b) => b.id === id)
      if (before === undefined) continue
      queryClient.setQueryData(queryKey, (data: unknown) =>
        hasBlocks(data) ? { ...data, blocks: data.blocks.map((b) => (b.id === id ? before : b)) } : data,
      )
    }
  }

  function undoToast(text: string, onUndo: () => void) {
    toast.show({ text, tone: 'success', action: { label: he.common.undo, onAction: onUndo }, timeoutMs: UNDO_TIMEOUT_MS })
  }

  // The callbacks live on the mutation, not on mutate(), so they still run when the screen that
  // started the action is gone (a toast's undo outlives a route change).
  const completeMutation = useMutation<CompleteResult, ApiError, Vars, Snapshot>({
    mutationKey,
    mutationFn: ({ block }) => api.post<CompleteResult>(`/blocks/${block.id}/complete`),
    onMutate: ({ block }) => patchBlock(block.id, (b) => ({ ...b, status: 'done', state: 'done' })),
    onError: (error, { block }, snapshot) => {
      restore(block.id, snapshot)
      fail(error)
    },
    onSuccess: (result) => {
      undoToast(he.board.completed, () => {
        uncompleteMutation.mutate({ block: result.block })
      })
    },
    onSettled: settle,
  })

  const uncompleteMutation = useMutation<CompleteResult, ApiError, Vars, Snapshot>({
    mutationKey,
    mutationFn: ({ block }) => api.post<CompleteResult>(`/blocks/${block.id}/uncomplete`),
    onMutate: ({ block }) => patchBlock(block.id, (b) => ({ ...b, status: 'planned', state: plannedState(b) })),
    onError: (error, { block }, snapshot) => {
      restore(block.id, snapshot)
      fail(error)
    },
    onSuccess: (result) => {
      undoToast(he.board.uncompleted, () => {
        completeMutation.mutate({ block: result.block })
      })
    },
    onSettled: settle,
  })

  const pinMutation = useMutation<Block, ApiError, Vars, Snapshot>({
    mutationKey,
    mutationFn: ({ block, pinned }) => api.patch<Block>(`/blocks/${block.id}`, { pinned: pinned === true }),
    onMutate: ({ block, pinned }) => patchBlock(block.id, (b) => ({ ...b, pinned: pinned === true })),
    onError: (error, { block }, snapshot) => {
      restore(block.id, snapshot)
      fail(error)
    },
    onSuccess: (result) => {
      undoToast(result.pinned ? he.board.pinnedDone : he.board.unpinnedDone, () => {
        pinMutation.mutate({ block: result, pinned: !result.pinned })
      })
    },
    onSettled: settle,
  })

  function undoDefer(versionId: string) {
    api
      .post('/plan/undo', { version_id: versionId })
      .then(
        () => {
          toast.show({ text: he.board.deferUndone, tone: 'success' })
        },
        // nothing_to_undo or stale_plan: another version came in between. The refetch shows the board as it is.
        fail,
      )
      .finally(() => {
        void settle()
      })
  }

  const deferMutation = useMutation<DeferResult, ApiError, Vars, DeferContext>({
    mutationKey: deferKey(userId),
    mutationFn: ({ block }) => api.post<DeferResult>(`/blocks/${block.id}/defer`),
    onMutate: ({ block }) => {
      const known = new Set<string>()
      for (const [, data] of queryClient.getQueriesData({ queryKey: key })) {
        if (hasBlocks(data)) for (const b of data.blocks) if (b.task_id === block.task_id) known.add(b.id)
      }
      return { known, today: queryClient.getQueryData<Today>(todayKey(userId))?.date }
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'placement_failed') {
        const reason = error.details.reason
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
        next === undefined
          ? he.board.deferredSomewhere
          : he.board.deferred(dayLabel(next.study_date, today), formatTime(next.starts_at, tz))
      const versionId = result.version_id
      if (versionId === null) {
        toast.show({ text, tone: 'success' })
      } else {
        undoToast(text, () => {
          undoDefer(versionId)
        })
      }
    },
    onSettled: settle,
  })

  const pendingIds = useMutationState({
    filters: { mutationKey, status: 'pending' },
    select: (mutation) => (mutation.state.variables as Vars | undefined)?.block.id,
  })
  const deferringIds = useMutationState({
    filters: { mutationKey: deferKey(userId), status: 'pending' },
    select: (mutation) => (mutation.state.variables as Vars | undefined)?.block.id,
  })
  const pending = useCallback((blockId: string) => pendingIds.includes(blockId), [pendingIds])
  const deferring = useCallback((blockId: string) => deferringIds.includes(blockId), [deferringIds])

  return {
    complete: (block) => {
      completeMutation.mutate({ block })
    },
    uncomplete: (block) => {
      uncompleteMutation.mutate({ block })
    },
    defer: (block) => {
      deferMutation.mutate({ block })
    },
    setPinned: (block, pinned) => {
      pinMutation.mutate({ block, pinned })
    },
    pending,
    deferring,
  }
}
