import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import type { ApiError } from '../api/client'
import { useMe, useUserId } from '../api/me'
import { boardKey } from '../board/api'
import { examsKey, planKey, todayKey, useUndo } from '../onboarding/api'
import type { ExamResponse, UndoResponse } from '../onboarding/types'
import type {
  ExamTask,
  PlanResponse,
  TaskCreate,
  TaskDeleteResponse,
  TaskPatch,
  TaskWriteResponse,
  Topic,
  TopicPatch,
  TopicsResponse,
} from './types'
import { studyDateIn, todayIn } from './dates'

// New keys (S15 Global Constraints). The exam's slice of the board sits under planKey, so every
// board change that invalidates ['plan', userId] refreshes the timeline too.
export const tasksKey = (userId: string | null, examId?: string) =>
  (examId === undefined ? ['tasks', userId] : ['tasks', userId, examId]) as readonly unknown[]
export const topicsKey = (userId: string | null, examId?: string) =>
  (examId === undefined ? ['topics', userId] : ['topics', userId, examId]) as readonly unknown[]
export const examPlanKey = (userId: string | null, examId: string, from: string, to: string) =>
  ['plan', userId, 'exam', examId, from, to] as const

type QueryClient = ReturnType<typeof useQueryClient>

function invalidateBoard(queryClient: QueryClient, userId: string | null) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: planKey(userId) }),
    queryClient.invalidateQueries({ queryKey: todayKey(userId) }),
    // The today and week screens (S14) keep the board under one key.
    queryClient.invalidateQueries({ queryKey: boardKey(userId) }),
  ])
}

export function useExamTasks(examId: string): UseQueryResult<ExamTask[], ApiError> {
  const api = useApi()
  const userId = useUserId()
  return useQuery<ExamTask[], ApiError>({
    queryKey: tasksKey(userId, examId),
    queryFn: ({ signal }) => api.get<ExamTask[]>(`/exams/${examId}/tasks`, { signal }),
    enabled: userId !== null,
  })
}

export function useExamTopics(examId: string): UseQueryResult<TopicsResponse, ApiError> {
  const api = useApi()
  const userId = useUserId()
  return useQuery<TopicsResponse, ApiError>({
    queryKey: topicsKey(userId, examId),
    queryFn: ({ signal }) => api.get<TopicsResponse>(`/exams/${examId}/topics`, { signal }),
    enabled: userId !== null,
  })
}

// GET /plan for the exam's days (plan decision 13). range null: no day to ask about.
export function useExamPlan(
  examId: string,
  range: { from: string; to: string } | null,
): UseQueryResult<PlanResponse, ApiError> {
  const api = useApi()
  const userId = useUserId()
  const from = range?.from ?? ''
  const to = range?.to ?? ''
  return useQuery<PlanResponse, ApiError>({
    queryKey: examPlanKey(userId, examId, from, to),
    queryFn: ({ signal }) => api.get<PlanResponse>(`/plan?from=${from}&to=${to}`, { signal }),
    enabled: userId !== null && range !== null,
  })
}

export interface ExamPatchVars {
  examId: string
  body: { name?: string; exam_date?: string; difficulty?: number }
}

// PATCH /exams/{id}. plan_affected tells the caller to offer a replan.
export function useUpdateExam(): UseMutationResult<ExamResponse, ApiError, ExamPatchVars> {
  const api = useApi()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<ExamResponse, ApiError, ExamPatchVars>({
    mutationFn: ({ examId, body }) => api.patch<ExamResponse>(`/exams/${examId}`, body),
    onSuccess: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: examsKey(userId) }), invalidateBoard(queryClient, userId)]),
  })
}

// Every task write touches the board (a placement), the exam's task list and its topics (an old
// topic is listed only while a live task points at it).
function useTaskWrite<V, R>(mutationFn: (vars: V) => Promise<R>, examOf: (vars: V) => string) {
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<R, ApiError, V>({
    mutationFn,
    onSuccess: (_answer, vars) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: tasksKey(userId, examOf(vars)) }),
        queryClient.invalidateQueries({ queryKey: topicsKey(userId, examOf(vars)) }),
        invalidateBoard(queryClient, userId),
      ]),
    onError: (error, vars) => {
      // A task that is gone (deleted elsewhere): the list is stale.
      if (error.status === 404) void queryClient.invalidateQueries({ queryKey: tasksKey(userId, examOf(vars)) })
    },
  })
}

export function useCreateTask() {
  const api = useApi()
  return useTaskWrite(
    (body: TaskCreate) => api.post<TaskWriteResponse>('/tasks', body),
    (body) => body.exam_id,
  )
}

export interface TaskPatchVars {
  taskId: string
  examId: string
  body: TaskPatch
}

export function useUpdateTask() {
  const api = useApi()
  return useTaskWrite(
    ({ taskId, body }: TaskPatchVars) => api.patch<TaskWriteResponse>(`/tasks/${taskId}`, body),
    (vars) => vars.examId,
  )
}

export function useDeleteTask() {
  const api = useApi()
  return useTaskWrite(
    ({ taskId }: { taskId: string; examId: string }) => api.delete<TaskDeleteResponse>(`/tasks/${taskId}`),
    (vars) => vars.examId,
  )
}

// POST /plan/undo (useUndo), then the tasks and topics too: an undo brings a deleted task back or
// puts an edited one where it was, and an old topic comes and goes with its tasks.
export function useTaskUndo(): (versionId: string) => Promise<UndoResponse> {
  const { mutateAsync } = useUndo()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return async (versionId) => {
    const answer = await mutateAsync(versionId)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tasksKey(userId) }),
      queryClient.invalidateQueries({ queryKey: topicsKey(userId) }),
    ])
    return answer
  }
}

export interface TopicPatchVars {
  topicId: string
  examId: string
  body: TopicPatch
}

// PATCH /topics/{id}: name and weight only, which do not touch the board (plan decision 6).
export function useUpdateTopic(): UseMutationResult<Topic, ApiError, TopicPatchVars> {
  const api = useApi()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<Topic, ApiError, TopicPatchVars>({
    mutationFn: ({ topicId, body }) => api.patch<Topic>(`/topics/${topicId}`, body),
    onSettled: (_answer, _error, vars) => queryClient.invalidateQueries({ queryKey: topicsKey(userId, vars.examId) }),
  })
}

// Today in the profile's zone (spec 7.3); the browser's until the profile has loaded.
// today: the calendar day, which the exam date rules use (the API refuses exam_date <= it).
// studyDay: the study day (before wake_time still the day before), which GET /plan filters by,
// so the timeline starts from it.
export function useToday(): { today: string; studyDay: string; timeZone: string } {
  const me = useMe()
  const timeZone = me.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const now = new Date()
  const today = todayIn(timeZone, now)
  const studyDay = me.data === undefined ? today : studyDateIn(timeZone, me.data.wake_time, now)
  return { today, studyDay, timeZone }
}
