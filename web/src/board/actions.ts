import { useMutation, useMutationState, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useApi } from '../api/ApiContext'
import { ApiError, errorMessage } from '../api/client'
import type { DeferRequest } from '../availability/types'
import { emitCompleted } from './xpEvents'
import { tasksKey } from '../exam/api'
import { codeText, unscheduledText } from '../i18n/codes'
import { en } from '../i18n/en'
import { progressKey } from '../progress/api'
import type { Progress } from '../progress/types'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'
import { boardKey, todayKey, useBoardUserId } from './api'
import { blockName } from './blockName'
import { requestFocus } from './focus'
import { useOfferReplan } from './offerReplan'
import { completeText } from './progressText'
import { blockMinutes, dateIn, dayLabel, formatTime, useProfileTimezone } from './time'
import type { Block, BlockState, CompleteResult, DeferResult, SkipResult, Today } from './types'
import { undoOnce } from './undoOnce'

// The actions on one block, shared by every part of the calendar that shows blocks.
//
// complete, uncomplete and pin are optimistic: their result is known (one block's status or pinned),
// so every board query in the cache (today and every plan range) shows it at once. A failure puts
// the snapshot taken before back, with a toast. Their undo is the opposite action (spec 7.6 step 8:
// they create no plan version).
//
// defer is not optimistic: the planner on the server picks the new place, and may find none. The
// defer sheet shows its choice as pending until the answer; the undo is POST /plan/undo with the
// version it created.
// S32: the calendar's defer sheet sends a choice (DeferRequest) and hears back through DeferOptions.
//
// skip (S32) is not optimistic either: the server removes the task's open blocks and writes a
// version, and its undo is POST /plan/undo with it. A block that ended goes through S18's
// POST /blocks/{id}/skip; one that did not end yet skips its task (PATCH /tasks/{id}).
//
// complete also writes the new XP total and level into the progress cache at once, and tells the
// calendar once that XP was earned (board/xpEvents.ts); the refetch then brings the rest.
//
// After every action the whole board (['board', userId]) is refetched.
//
// The optimistic actions also keep "today"'s planned_minutes and done_minutes in step with the
// block's status, so the meter moves at once (S18 decision 14b), and they ask for the focus to come
// back to the block's card, wherever it shows next (focus.ts, decision 14a).

// For the screen that deferred (the calendar's defer sheet). They travel in the mutation's
// variables and run from the mutation's own callbacks, so they still run once that screen is gone.
export interface DeferOptions {
  // After the success toast.
  onSuccess?(): void
  // After any failure (after the replan offer for placement_failed). Returning true means the
  // caller shows the error itself, so no toast; placement_failed's offer is shown either way.
  onError?(error: ApiError): boolean
}

export interface BlockActions {
  complete(block: Block): void
  uncomplete(block: Block): void
  // Without `request`: POST /blocks/{id}/defer with no body, the next free place (S14).
  defer(block: Block, request?: DeferRequest, options?: DeferOptions): void
  skip(block: Block): void
  setPinned(block: Block, pinned: boolean): void
  // True while an action on this block is running, in any screen.
  pending(blockId: string): boolean
  // True while this block's task is being skipped.
  skipping(blockId: string): boolean
}

interface Vars {
  block: Block
  pinned?: boolean
  // What had the focus when the action started (focus.ts).
  origin?: Element | null
  // A complete that is the Undo of "Not done": it puts back a mark the user already had, so the
  // calendar does not play its reward again (S32 Task 13, a manager ruling).
  undo?: boolean
}

interface DeferVars extends Vars {
  request?: DeferRequest
  options?: DeferOptions
}

// What both skips answer with that skip reads: POST /blocks/{id}/skip answers SkipResult, and
// PATCH /tasks/{id} answers TaskPatchResponse (task, placement, version_id); both carry version_id.
type SkipAnswer = Pick<SkipResult, 'version_id'>

export type Snapshot = [QueryKey, unknown][]

// Every block action's mutation key starts with this, so pending(id) covers them all (move.ts too).
export function actionKey(userId: string | null) {
  return ['blockAction', userId] as const
}
function deferKey(userId: string | null) {
  return [...actionKey(userId), 'defer'] as const
}
function skipKey(userId: string | null) {
  return [...actionKey(userId), 'skip'] as const
}

// What defer remembers before it runs: the task's blocks it already knew, and today's study day.
interface DeferContext {
  known: Set<string>
  today: string | undefined
}

function hasBlocks(data: unknown): data is { blocks: Block[] } {
  return typeof data === 'object' && data !== null && Array.isArray((data as { blocks?: unknown }).blocks)
}

// GET /today: the only board answer with minutes. Plan ranges have blocks but no minutes.
function isToday(data: unknown): data is Today {
  return (
    hasBlocks(data) &&
    typeof (data as { planned_minutes?: unknown }).planned_minutes === 'number' &&
    typeof (data as { done_minutes?: unknown }).done_minutes === 'number'
  )
}

function minutesIf(block: Block, status: Block['status']): number {
  return block.status === status ? blockMinutes(block) : 0
}

// One board answer with the block `id` replaced by `next(block)`. In "today" its minutes move with
// it: out of planned or done by what it was, into them by what it is now. The change is relative,
// so the totals stay right whatever else changed in the cache in between.
function replaceBlock(data: unknown, id: string, next: (block: Block) => Block): unknown {
  if (!hasBlocks(data)) return data
  const index = data.blocks.findIndex((b) => b.id === id)
  const before = data.blocks[index]
  if (before === undefined) return data
  const after = next(before)
  const blocks = data.blocks.with(index, after)
  if (!isToday(data)) return { ...data, blocks }
  return {
    ...data,
    blocks,
    planned_minutes: Math.max(0, data.planned_minutes - minutesIf(before, 'planned') + minutesIf(after, 'planned')),
    done_minutes: Math.max(0, data.done_minutes - minutesIf(before, 'done') + minutesIf(after, 'done')),
  }
}

// Change the block `id` in every board query at once; the snapshot taken before is returned for
// restoreBoardBlock.
export async function patchBoardBlock(
  queryClient: QueryClient,
  key: QueryKey,
  id: string,
  patch: (block: Block) => Block,
): Promise<Snapshot> {
  await queryClient.cancelQueries({ queryKey: key })
  const snapshot = queryClient.getQueriesData({ queryKey: key })
  queryClient.setQueriesData({ queryKey: key }, (data: unknown) => replaceBlock(data, id, patch))
  return snapshot
}

// Put back only this block, as the snapshot had it: another action, or a refetch that landed in
// between, may have changed the rest of the board since, and that stays. Today's minutes move
// back with the block (replaceBlock), so they agree with whatever the rest of the board is now.
export function restoreBoardBlock(queryClient: QueryClient, id: string, snapshot: Snapshot | undefined): void {
  for (const [queryKey, saved] of snapshot ?? []) {
    if (!hasBlocks(saved)) continue
    const before = saved.blocks.find((b) => b.id === id)
    if (before === undefined) continue
    queryClient.setQueryData(queryKey, (data: unknown) => replaceBlock(data, id, () => before))
  }
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

  // The exam's tasks are not under the board, but an action changes them too (a Done or a Skip
  // moves "Your exams" and the exam screen's list).
  const settle = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: tasksKey(userId) }),
    ])
  const fail = (error: unknown) => {
    toast.show({ text: errorMessage(error), tone: 'error' })
  }
  // The optimistic actions remember what had the focus when they started, and once they settled
  // (done or rolled back) ask for the focus to go to the block's card from there (focus.ts).
  const started = (block: Block, pinned?: boolean): Vars => ({ block, pinned, origin: document.activeElement })
  const settleAndFocus = (_data: unknown, _error: unknown, { block, origin }: Vars) => {
    requestFocus(queryClient, block.id, origin ?? null)
    return settle()
  }

  const patchBlock = (id: string, patch: (block: Block) => Block) => patchBoardBlock(queryClient, key, id, patch)
  const restore = (id: string, snapshot: Snapshot | undefined) => {
    restoreBoardBlock(queryClient, id, snapshot)
  }

  function undoToast(text: string, onUndo: () => void) {
    toast.show({ text, tone: 'success', action: { label: en.common.undo, onAction: onUndo }, timeoutMs: UNDO_TIMEOUT_MS })
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
    onSuccess: (result, { undo }) => {
      const progress = result.progress
      if (progress !== undefined) {
        // An empty cache stays empty: the updater returns undefined, and nothing is written.
        queryClient.setQueryData<Progress>(progressKey(userId), (data) =>
          data === undefined ? undefined : { ...data, total_xp: progress.total_xp, level: progress.level },
        )
        if (progress.xp_change > 0 && undo !== true) emitCompleted({ blockId: result.block.id, xp: progress.xp_change })
      }
      undoToast(completeText(result, false), () => {
        uncompleteMutation.mutate(started(result.block))
      })
    },
    onSettled: settleAndFocus,
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
      undoToast(completeText(result, true), () => {
        completeMutation.mutate({ ...started(result.block), undo: true })
      })
    },
    onSettled: settleAndFocus,
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
      undoToast(result.pinned ? en.board.pinnedDone : en.board.unpinnedDone, () => {
        pinMutation.mutate(started(result, !result.pinned))
      })
    },
    onSettled: settleAndFocus,
  })

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

  const deferMutation = useMutation<DeferResult, ApiError, DeferVars, DeferContext>({
    mutationKey: deferKey(userId),
    mutationFn: ({ block, request }) =>
      request === undefined
        ? api.post<DeferResult>(`/blocks/${block.id}/defer`)
        : api.post<DeferResult>(`/blocks/${block.id}/defer`, request),
    onMutate: ({ block }) => {
      const known = new Set<string>()
      for (const [, data] of queryClient.getQueriesData({ queryKey: key })) {
        if (hasBlocks(data)) for (const b of data.blocks) if (b.task_id === block.task_id) known.add(b.id)
      }
      return { known, today: queryClient.getQueryData<Today>(todayKey(userId))?.date }
    },
    onError: (error, { options }) => {
      if (error instanceof ApiError && error.code === 'placement_failed') {
        const reason = error.details.reason
        const why = typeof reason === 'string' ? `${codeText('placement_failed')} ${unscheduledText(reason)}` : codeText('placement_failed')
        offerReplan(why)
        options?.onError?.(error)
        return
      }
      if (options?.onError?.(error) === true) return
      fail(error)
    },
    onSuccess: (result, { options }, context) => {
      const next = movedTo(result.blocks, context.known)
      // "Today" is the server's study day (after midnight, before sleep, it is still yesterday's date).
      const today = context.today ?? dateIn(tz)
      const text =
        next === undefined
          ? en.board.deferredSomewhere
          : en.board.deferred(dayLabel(next.study_date, today), formatTime(next.starts_at, tz))
      const versionId = result.version_id
      if (versionId === null) {
        toast.show({ text, tone: 'success' })
      } else {
        undoToast(text, () => {
          undoVersion(versionId, en.board.deferUndone)
        })
      }
      options?.onSuccess?.()
    },
    onSettled: settle,
  })

  // By the clock when pressed: the board's `state` may be a refetch old.
  const skipMutation = useMutation<SkipAnswer, ApiError, Vars>({
    mutationKey: skipKey(userId),
    mutationFn: ({ block }) =>
      Date.parse(block.ends_at) <= Date.now()
        ? api.post<SkipResult>(`/blocks/${block.id}/skip`)
        : api.patch<SkipAnswer>(`/tasks/${block.task_id}`, { status: 'skipped' }),
    onError: fail,
    onSuccess: (result, { block }) => {
      const text = en.calendar.sheets.defer.skipped(blockName(block))
      const versionId = result.version_id
      if (versionId === null) {
        toast.show({ text, tone: 'success' })
      } else {
        undoToast(text, () => {
          undoVersion(versionId, en.review.skipUndone)
        })
      }
    },
    onSettled: settle,
  })

  const pendingIds = useMutationState({
    filters: { mutationKey, status: 'pending' },
    select: (mutation) => (mutation.state.variables as Vars | undefined)?.block.id,
  })
  const skippingIds = useMutationState({
    filters: { mutationKey: skipKey(userId), status: 'pending' },
    select: (mutation) => (mutation.state.variables as Vars | undefined)?.block.id,
  })
  const pending = useCallback((blockId: string) => pendingIds.includes(blockId), [pendingIds])
  const skipping = useCallback((blockId: string) => skippingIds.includes(blockId), [skippingIds])

  return {
    complete: (block) => {
      completeMutation.mutate(started(block))
    },
    uncomplete: (block) => {
      uncompleteMutation.mutate(started(block))
    },
    defer: (block, request, options) => {
      deferMutation.mutate({ block, request, options })
    },
    skip: (block) => {
      skipMutation.mutate({ block })
    },
    setPinned: (block, pinned) => {
      pinMutation.mutate(started(block, pinned))
    },
    pending,
    skipping,
  }
}
