import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useApi } from '../api/ApiContext'
import { ApiError, errorMessage } from '../api/client'
import { boardKey, useBoardUserId } from '../board/api'
import { undoOnce } from '../board/undoOnce'
import { tasksKey } from '../exam/api'
import type { ExamTask } from '../exam/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { examsKey, planKey, todayKey } from '../onboarding/api'
import { UNDO_TIMEOUT_MS, useToast } from '../ui/useToast'
import { emitBloom } from './bloomEvents'
import type { MoedBErrors } from './moedBForm'
import type { ClosureItem, CloseResult, MoedBBody, MoedBResult, Outcome } from './types'

// The actions of closing an exam (S45): close it ("Nailed it" / "Keep open for Moed B"), open its
// Moed B (POST /exams/{id}/moed-b builds the new plan in the same request), and Undo either.
//
// The callbacks live on the mutations, not on mutate() (the pattern of calendar/splitActions.ts), so
// the toast of "I'm done with it" and its Undo still work once the exam screen is gone. The handlers a
// caller passes travel in the variables and run from there too: the sheet checks itself whether it is
// still mounted.
//
// Their key is neither actionKey() nor the split's: useBlockActions().pending and
// useSplitActions().splitting read the variables of every mutation under their keys.

export type CloseFailure = { kind: 'stale' } | { kind: 'error'; message: string }
export type MoedBFailure = { kind: 'stale' } | { kind: 'fields'; errors: MoedBErrors } | { kind: 'error'; message: string }
export interface UndoFailure {
  message: string
}

type ExamRef = Pick<ClosureItem, 'exam_id' | 'exam_name'>

export interface CloseHandlers {
  onSuccess?(result: CloseResult): void
  onError?(failure: CloseFailure): void
}
export interface MoedBHandlers {
  // simulations: how many practice exams the round starts with, for en.closure.moedB.done.
  onSuccess?(result: MoedBResult, simulations: number): void
  onError?(failure: MoedBFailure): void
}
export interface UndoHandlers {
  onSuccess?(): void
  onError?(failure: UndoFailure): void
}

export interface ClosureActions {
  close(item: ExamRef, outcome: Outcome, handlers?: CloseHandlers): void
  // "I'm done with it" from the exam screen: close done with a toast and its Undo.
  finish(item: ExamRef): void
  openMoedB(examId: string, body: MoedBBody, handlers?: MoedBHandlers): void
  undo(versionId: string, reason: 'close' | 'moed_b', handlers?: UndoHandlers): void
  // True while the close of this exam (also through finish) is on its way.
  closing(examId: string): boolean
  // True while the Moed B of this exam is being planned.
  planning(examId: string): boolean
  // True while the undo of this version is on its way.
  undoing(versionId: string): boolean
}

interface CloseVars {
  item: ExamRef
  outcome: Outcome
  handlers?: CloseHandlers | undefined
  // From finish: the hook shows the toast and its Undo itself.
  finish: boolean
}
interface MoedBVars {
  examId: string
  body: MoedBBody
  handlers?: MoedBHandlers | undefined
}
interface MoedBAnswer {
  result: MoedBResult
  simulations: number
}
interface UndoVars {
  versionId: string
  reason: 'close' | 'moed_b'
  handlers?: UndoHandlers | undefined
  // The undo itself, already claimed through undoOnce.
  request: Promise<unknown>
}

export function closureActionKey(userId: string | null) {
  return ['closureAction', userId] as const
}
function closeKey(userId: string | null) {
  return [...closureActionKey(userId), 'close'] as const
}
function moedBKey(userId: string | null) {
  return [...closureActionKey(userId), 'moedB'] as const
}
function undoKey(userId: string | null) {
  return [...closureActionKey(userId), 'undo'] as const
}

// The server's rule (api/app/domain/moed_b.py, _simulations): Moed A's simulations, in any status and
// without their reviews, at most two; none means one default practice exam.
const MAX_SIMULATIONS = 2
function simulationCount(tasks: readonly ExamTask[]): number {
  const n = tasks.filter((t) => t.kind === 'simulation').length
  return Math.min(MAX_SIMULATIONS, Math.max(1, n))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// The text of a decision that went stale (the exam closed in another tab, its date changed, or it is
// gone), or null for any other failure.
function staleText(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  if (error.status === 409 && error.code === 'invalid_state') return en.closure.sheet.stale
  if (error.status === 404) return codeText('not_found')
  return null
}

// A 422 of POST /exams/{id}/moed-b: the date field, or the general validation text.
function moedBInvalid(error: ApiError): MoedBFailure {
  if (error.code === 'exam_in_past') return { kind: 'fields', errors: { date: en.onboardingExams.dateTooEarly } }
  if (error.code === 'validation_error') {
    const errors = error.details.errors
    const tooFar =
      Array.isArray(errors) &&
      errors.some((e) => isRecord(e) && Array.isArray(e.loc) && e.loc[e.loc.length - 1] === 'exam_date' && e.type === 'too_far_ahead')
    if (tooFar) return { kind: 'fields', errors: { date: en.onboardingExams.dateTooLate } }
  }
  return { kind: 'error', message: codeText('validation_error') }
}

export function useClosureActions(): ClosureActions {
  const api = useApi()
  const queryClient = useQueryClient()
  const toast = useToast()
  const userId = useBoardUserId()
  const s = en.closure.sheet

  // boardKey holds the closures, the progress, and the board's today, plan and exams. The exams list,
  // the exam screen and the calendar read the onboarding keys and the exam's tasks, outside it.
  const settle = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: boardKey(userId) }),
      queryClient.invalidateQueries({ queryKey: examsKey(userId) }),
      queryClient.invalidateQueries({ queryKey: planKey(userId) }),
      queryClient.invalidateQueries({ queryKey: todayKey(userId) }),
      queryClient.invalidateQueries({ queryKey: tasksKey(userId) }),
    ])

  const undoMutation = useMutation<unknown, ApiError, UndoVars>({
    mutationKey: undoKey(userId),
    mutationFn: ({ request }) => request,
    onSuccess: (_data, { handlers }) => {
      handlers?.onSuccess?.()
    },
    onError: (error, { reason, handlers }) => {
      // invalid_state of moed_b_opened: a Moed B task was done or skipped, or a block of it runs now.
      // stale_plan and nothing_to_undo: the code's own text.
      const message =
        reason === 'moed_b' && error instanceof ApiError && error.code === 'invalid_state'
          ? en.closure.moedB.cantUndo
          : errorMessage(error)
      handlers?.onError?.({ message })
    },
    onSettled: settle,
  })

  function undo(versionId: string, reason: 'close' | 'moed_b', handlers?: UndoHandlers) {
    const request = undoOnce(queryClient, versionId, () => api.post('/plan/undo', { version_id: versionId }))
    if (request === null) return
    undoMutation.mutate({ versionId, reason, handlers, request })
  }

  const closeMutation = useMutation<CloseResult, ApiError, CloseVars>({
    mutationKey: closeKey(userId),
    mutationFn: ({ item, outcome }) => api.post<CloseResult>(`/exams/${item.exam_id}/close`, { outcome }),
    onSuccess: (result, { item, outcome, handlers, finish }) => {
      if (outcome === 'done' && result.event !== null) emitBloom(result.event)
      handlers?.onSuccess?.(result)
      if (!finish) return
      const versionId = result.version_id
      toast.show({
        text: s.bloomed(item.exam_name),
        tone: 'success',
        action: {
          label: en.common.undo,
          onAction: () => {
            undo(versionId, 'close', {
              onSuccess: () => {
                toast.show({ text: s.undone(item.exam_name), tone: 'success' })
              },
              onError: ({ message }) => {
                toast.show({ text: message, tone: 'error' })
              },
            })
          },
        },
        timeoutMs: UNDO_TIMEOUT_MS,
      })
    },
    onError: (error, { handlers, finish }) => {
      // The refetch in settle has already happened by the time the student reads this.
      const stale = staleText(error)
      if (stale !== null) {
        toast.show({ text: stale, tone: 'info' })
        handlers?.onError?.({ kind: 'stale' })
        return
      }
      const message = errorMessage(error)
      // The sheet shows the error itself; the exam screen has only the toast.
      if (finish) toast.show({ text: message, tone: 'error' })
      handlers?.onError?.({ kind: 'error', message })
    },
    onSettled: settle,
  })

  const moedBMutation = useMutation<MoedBAnswer, ApiError, MoedBVars>({
    mutationKey: moedBKey(userId),
    mutationFn: async ({ examId, body }) => {
      // Before the submit: the answer does not say how many practice exams the round starts with, and
      // after it the exam's tasks are those of Moed B. While the exam waits for Moed B its tasks are
      // Moed A's (GET /exams/{id}/tasks answers the exam's current sitting).
      // The tasks the web holds, else asked for once (a failure fails the action before anything is sent).
      const key = tasksKey(userId, examId)
      const tasks = await queryClient.query<ExamTask[]>({
        queryKey: key,
        queryFn: ({ signal }) => api.get<ExamTask[]>(`/exams/${examId}/tasks`, { signal }),
        staleTime: 'static',
      })
      const simulations = simulationCount(tasks)
      const result = await api.post<MoedBResult>(`/exams/${examId}/moed-b`, body)
      return { result, simulations }
    },
    onSuccess: ({ result, simulations }, { handlers }) => {
      handlers?.onSuccess?.(result, simulations)
    },
    onError: (error, { handlers }) => {
      const stale = staleText(error)
      if (stale !== null) {
        toast.show({ text: stale, tone: 'info' })
        handlers?.onError?.({ kind: 'stale' })
        return
      }
      if (error instanceof ApiError && error.status === 422) {
        handlers?.onError?.(moedBInvalid(error))
        return
      }
      // The form shows it above its button and keeps what the student filled in.
      handlers?.onError?.({ kind: 'error', message: errorMessage(error) })
    },
    onSettled: settle,
  })

  const closingIds = useMutationState({
    filters: { mutationKey: closeKey(userId), status: 'pending' },
    select: (mutation) => (mutation.state.variables as CloseVars | undefined)?.item.exam_id,
  })
  const planningIds = useMutationState({
    filters: { mutationKey: moedBKey(userId), status: 'pending' },
    select: (mutation) => (mutation.state.variables as MoedBVars | undefined)?.examId,
  })
  const undoingIds = useMutationState({
    filters: { mutationKey: undoKey(userId), status: 'pending' },
    select: (mutation) => (mutation.state.variables as UndoVars | undefined)?.versionId,
  })
  const closing = useCallback((examId: string) => closingIds.includes(examId), [closingIds])
  const planning = useCallback((examId: string) => planningIds.includes(examId), [planningIds])
  const undoing = useCallback((versionId: string) => undoingIds.includes(versionId), [undoingIds])

  // Read from the mutation cache, not from closingIds: a second press in the same tick comes before
  // the re-render. A mutation turns pending synchronously inside mutate().
  function closeRunning(examId: string) {
    return (
      queryClient.isMutating({
        mutationKey: closeKey(userId),
        predicate: (m) => (m.state.variables as CloseVars | undefined)?.item.exam_id === examId,
      }) > 0
    )
  }

  return {
    close: (item, outcome, handlers) => {
      if (closeRunning(item.exam_id)) return
      closeMutation.mutate({ item, outcome, handlers, finish: false })
    },
    finish: (item) => {
      if (closeRunning(item.exam_id)) return
      closeMutation.mutate({ item, outcome: 'done', finish: true })
    },
    openMoedB: (examId, body, handlers) => {
      const running = queryClient.isMutating({
        mutationKey: moedBKey(userId),
        predicate: (m) => (m.state.variables as MoedBVars | undefined)?.examId === examId,
      })
      if (running > 0) return
      moedBMutation.mutate({ examId, body, handlers })
    },
    undo,
    closing,
    planning,
    undoing,
  }
}
