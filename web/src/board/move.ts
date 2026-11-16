import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useApi } from '../api/ApiContext'
import { ApiError, errorMessage } from '../api/client'
import { codeText } from '../i18n/codes'
import { he } from '../i18n/he'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'
import { actionKey, patchBoardBlock, restoreBoardBlock, type Snapshot } from './actions'
import { boardKey, useBoardUserId } from './api'
import { requestFocus } from './focus'
import { blockMinutes, formatTime, useProfileTimezone } from './time'
import type { Block } from './types'

// Moving a block within its day (S18 decisions 7–12): PATCH /blocks/{id} {starts_at}. The server
// keeps the duration and pins the block. The web keeps the 15-minute grid (decision 10: the grid is
// the shape of the interaction, the server checks only what must always hold), and checks the
// server's rules before it asks, so a drag shows at once whether the place is free.

export const GRID_MINUTES = 15
const MINUTE_MS = 60_000
const GRID_MS = GRID_MINUTES * MINUTE_MS

const offsetFormats = new Map<string, Intl.DateTimeFormat>()

// The offset of `tz` from UTC at `ms`, in minutes (Jerusalem in November: 120; Kathmandu: 345).
function offsetMinutes(ms: number, tz: string): number {
  let format = offsetFormats.get(tz)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
    offsetFormats.set(tz, format)
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(format.formatToParts(ms).find((p) => p.type === type)?.value ?? 0)
  const local = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'))
  const minuteStart = Math.floor(ms / MINUTE_MS) * MINUTE_MS
  return Math.round((local - minuteStart) / MINUTE_MS)
}

// The nearest quarter hour on the local clock of `tz`. The rounding is a shift of at most 7.5
// minutes measured on the local clock at `ms` itself, so a change of clock (DST) elsewhere in the
// day does not move it, and a zone like +05:45 gets its own quarter hours.
export function snapToGrid(ms: number, tz: string): number {
  const minute = Math.floor(ms / MINUTE_MS) * MINUTE_MS
  const local = minute + offsetMinutes(ms, tz) * MINUTE_MS
  const into = ((local % GRID_MS) + GRID_MS) % GRID_MS
  const rest = ms - minute
  return into + rest < GRID_MS / 2 ? minute - into : minute - into + GRID_MS
}

export interface MoveDay {
  // The waking hours of the block's study day (Today.day_starts_at / day_ends_at), null when none.
  dayStart: number | null
  dayEnd: number | null
  // The other blocks of the day (the block itself may be among them).
  blocks: Block[]
  now: number
}

export type MoveProblem = 'invalid_state' | 'outside_day' | 'slot_taken'

// What the server would refuse (decision 7), or null: the block is planned and did not start; the
// new start is a whole minute, not before now; the whole block is inside the waking hours; it does
// not overlap another planned or done block (touching one is fine, decision 9).
export function moveProblem(block: Block, startMs: number, day: MoveDay): MoveProblem | null {
  if (block.status !== 'planned' || Date.parse(block.starts_at) <= day.now) return 'invalid_state'
  const endMs = startMs + blockMinutes(block) * MINUTE_MS
  if (day.dayStart === null || day.dayEnd === null) return 'outside_day'
  if (startMs % MINUTE_MS !== 0 || startMs < day.now || startMs < day.dayStart || endMs > day.dayEnd) return 'outside_day'
  const taken = day.blocks.some(
    (other) =>
      other.id !== block.id &&
      (other.status === 'planned' || other.status === 'done') &&
      startMs < Date.parse(other.ends_at) &&
      Date.parse(other.starts_at) < endMs,
  )
  return taken ? 'slot_taken' : null
}

export function canMoveTo(block: Block, startMs: number, day: MoveDay): boolean {
  return moveProblem(block, startMs, day) === null
}

interface MoveVars {
  block: Block
  startsAt: string
  // Sent only by the undo (the old pinned); a move pins the block on the server.
  pinned?: boolean
  undo: boolean
  // What had the focus when the move started (focus.ts); `focus: false` asks for no focus at all
  // (the timeline's handle keeps its own focus).
  origin: Element | null
  focus: boolean
}

export interface MoveOptions {
  focus?: boolean
}

export interface MoveBlock {
  move: (block: Block, startsAt: string, options?: MoveOptions) => void
  // True while a move of this block runs.
  moving: (blockId: string) => boolean
}

function moveKey(userId: string | null) {
  return [...actionKey(userId), 'move'] as const
}

// The move is optimistic like pin (S14): the answer is known, the block's times and pinned, so every
// board query shows it at once, and a failure puts the block back with the reason. Its undo is the
// opposite PATCH, with the old start and the old pinned: a move writes no plan version (plan,
// "למה הזזה לא יוצרת גרסה"). The key is under the block actions', so actions.pending(id) covers it.
export function useMoveBlock(): MoveBlock {
  const api = useApi()
  const queryClient = useQueryClient()
  const toast = useToast()
  const userId = useBoardUserId()
  const tz = useProfileTimezone()
  const key = boardKey(userId)

  const mutation = useMutation<Block, ApiError, MoveVars, Snapshot>({
    mutationKey: moveKey(userId),
    mutationFn: ({ block, startsAt, pinned }) =>
      api.patch<Block>(`/blocks/${block.id}`, pinned === undefined ? { starts_at: startsAt } : { starts_at: startsAt, pinned }),
    onMutate: ({ block, startsAt, pinned }) => {
      const minutes = blockMinutes(block)
      const start = Date.parse(startsAt)
      return patchBoardBlock(queryClient, key, block.id, (b) => ({
        ...b,
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(start + minutes * MINUTE_MS).toISOString(),
        pinned: pinned ?? true,
      }))
    },
    onError: (error, { block }, snapshot) => {
      restoreBoardBlock(queryClient, block.id, snapshot)
      const text = error instanceof ApiError && error.code !== null ? codeText(error.code, error.details) : errorMessage(error)
      toast.show({ text, tone: 'error' })
    },
    onSuccess: (result, { block, undo }) => {
      if (undo) {
        toast.show({ text: he.move.undone, tone: 'success' })
        return
      }
      toast.show({
        text: he.move.moved(formatTime(result.starts_at, tz)),
        tone: 'success',
        action: {
          label: he.common.undo,
          onAction: () => {
            mutation.mutate({
              block: result,
              startsAt: block.starts_at,
              pinned: block.pinned,
              undo: true,
              origin: document.activeElement,
              focus: true,
            })
          },
        },
        timeoutMs: UNDO_TIMEOUT_MS,
      })
    },
    onSettled: (_data, _error, { block, origin, focus }) => {
      if (focus) requestFocus(queryClient, block.id, origin)
      return queryClient.invalidateQueries({ queryKey: key })
    },
  })

  const movingIds = useMutationState({
    filters: { mutationKey: moveKey(userId), status: 'pending' },
    select: (m) => (m.state.variables as MoveVars | undefined)?.block.id,
  })
  const moving = useCallback((blockId: string) => movingIds.includes(blockId), [movingIds])
  const { mutate } = mutation

  const move = useCallback(
    (block: Block, startsAt: string, options: MoveOptions = {}) => {
      mutate({ block, startsAt, undo: false, origin: document.activeElement, focus: options.focus ?? true })
    },
    [mutate],
  )

  return { move, moving }
}
