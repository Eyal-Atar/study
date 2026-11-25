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
import { emitBloom, rethrowLater } from './bloomEvents'
import type { MoedBErrors } from './moedBForm'
import { moedBDoneStatus } from './sheetParts'
import type { ClosureItem, CloseResult, MoedBBody, MoedBResult, Outcome } from './types'

// The actions of closing an exam (S45): close it ("Nailed it" / "Keep open for Moed B"), open its
// Moed B (POST /exams/{id}/moed-b builds the new plan in the same request), and Undo either.
//
// The callbacks live on the mutations, not on mutate() (the pattern of calendar/splitActions.ts), so
// the toast of "I'm done with it" and its Undo still work once the exam screen is gone. The handlers a
// caller passes travel in the variables and run from there too: the sheet checks itself whether it is
// still mounted, and each handler returns whether it showed the answer ("I showed it"). When none did
// (the sheet was gone by the time the answer came, or the handler threw), the action says it in a
// toast of its own, with its Undo, so a decision is never taken without a word.
//
// Their key is neither actionKey() nor the split's: useBlockActions().pending and
// useSplitActions().splitting read the variables of every mutation under their keys.

export type CloseFailure = { kind: 'stale' } | { kind: 'error'; message: string }
export type MoedBFailure = { kind: 'stale' } | { kind: 'fields'; errors: MoedBErrors } | { kind: 'error'; message: string }
export interface UndoFailure {
  message: string
}

type ExamRef = Pick<ClosureItem, 'exam_id' | 'exam_name'>

// Every handler returns true when it showed the answer, false when it did not (its component is gone).
// A stale failure is always the action's own toast; the return value of that onError is not read.
export interface CloseHandlers {
  onSuccess?(result: CloseResult): boolean
  onError?(failure: CloseFailure): boolean
}
export interface MoedBHandlers {
  // simulations: how many practice exams the round starts with, for en.closure.moedB.done.
  onSuccess?(result: MoedBResult, simulations: number): boolean
  onError?(failure: MoedBFailure): boolean
}
export interface UndoHandlers {
  onSuccess?(): boolean
  onError?(failure: UndoFailure): boolean
}

export interface ClosureActions {
  close(item: ExamRef, outcome: Outcome, handlers?: CloseHandlers): void
  // "I'm done with it" from the exam screen: close done with a toast and its Undo.
  finish(item: ExamRef): void
  openMoedB(examId: string, body: MoedBBody, handlers?: MoedBHandlers): void
  // name: the exam's, for the toast when no handler shows the answer.
  undo(versionId: string, reason: 'close' | 'moed_b', name: string, handlers?: UndoHandlers): void
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
  name: string
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

// Runs a caller's handler: true only when it says it showed the answer. A handler that throws must not
// stop the toast or the refresh after it; its error is thrown again outside the action.
function callHandler(run: () => boolean | undefined): boolean {
  try {
    return run() === true
  } catch (error) {
    rethrowLater(error)
    return false
  }
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
    onSuccess: (_data, { reason, name, handlers }) => {
      if (callHandler(() => handlers?.onSuccess?.())) return
      toast.show({ text: reason === 'close' ? s.undone(name) : en.closure.moedB.undone(name), tone: 'success' })
    },
    onError: (error, { reason, handlers }) => {
      // invalid_state of moed_b_opened: a Moed B task was done or skipped, or a block of it runs now.
      // stale_plan and nothing_to_undo: the code's own text.
      const message =
        reason === 'moed_b' && error instanceof ApiError && error.code === 'invalid_state'
          ? en.closure.moedB.cantUndo
          : errorMessage(error)
      if (callHandler(() => handlers?.onError?.({ message }))) return
      toast.show({ text: message, tone: 'error' })
    },
    onSettled: settle,
  })

  function undo(versionId: string, reason: 'close' | 'moed_b', name: string, handlers?: UndoHandlers) {
    const request = undoOnce(queryClient, versionId, () => api.post('/plan/undo', { version_id: versionId }))
    if (request === null) return
    undoMutation.mutate({ versionId, reason, name, handlers, request })
  }

  // The answer in a toast with its Undo, for 10 seconds; the Undo says its own answer in a toast too.
  function undoToast(text: string, versionId: string, reason: 'close' | 'moed_b', name: string) {
    toast.show({
      text,
      tone: 'success',
      action: {
        label: en.common.undo,
        onAction: () => {
          undo(versionId, reason, name)
        },
      },
      timeoutMs: UNDO_TIMEOUT_MS,
    })
  }

  const closeMutation = useMutation<CloseResult, ApiError, CloseVars>({
    mutationKey: closeKey(userId),
    mutationFn: ({ item, outcome }) => api.post<CloseResult>(`/exams/${item.exam_id}/close`, { outcome }),
    onSuccess: (result, { item, outcome, handlers, finish }) => {
      if (outcome === 'done' && result.event !== null) emitBloom(result.event)
      const shown = callHandler(() => handlers?.onSuccess?.(result))
      // finish (the exam screen) has only the toast.
      if (shown && !finish) return
      const name = item.exam_name
      undoToast(outcome === 'done' ? s.bloomed(name) : s.kept(name), result.version_id, 'close', name)
    },
    onError: (error, { handlers, finish }) => {
      // The refetch in settle has already happened by the time the student reads this.
      const stale = staleText(error)
      if (stale !== null) {
        toast.show({ text: stale, tone: 'info' })
        callHandler(() => handlers?.onError?.({ kind: 'stale' }))
        return
      }
      const message = errorMessage(error)
      // The sheet shows the error itself; the exam screen has only the toast.
      const shown = callHandler(() => handlers?.onError?.({ kind: 'error', message }))
      if (finish || !shown) toast.show({ text: message, tone: 'error' })
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
      // staleTime 'static' returns the cached tasks even when a refresh has marked them invalid, on
      // purpose: closing an exam does not change Moed A's tasks, and after a Moed B and its Undo the
      // count comes out the same (the server makes min(2, max(1, n)) practice exams from them).
      // A read that fails here fails the whole action, before the POST: nothing is sent.
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
      if (callHandler(() => handlers?.onSuccess?.(result, simulations))) return
      undoToast(moedBDoneStatus({ result, simulations }), result.version_id, 'moed_b', result.exam.name)
    },
    onError: (error, { handlers }) => {
      const stale = staleText(error)
      if (stale !== null) {
        toast.show({ text: stale, tone: 'info' })
        callHandler(() => handlers?.onError?.({ kind: 'stale' }))
        return
      }
      // The form shows it (a field error under its field, any other above its button) and keeps what
      // the student filled in. Without the form, a field error is the general validation text.
      const failure: MoedBFailure =
        error instanceof ApiError && error.status === 422 ? moedBInvalid(error) : { kind: 'error', message: errorMessage(error) }
      if (callHandler(() => handlers?.onError?.(failure))) return
      toast.show({ text: failure.kind === 'error' ? failure.message : codeText('validation_error'), tone: 'error' })
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
