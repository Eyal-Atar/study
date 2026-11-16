import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useApi } from '../api/ApiContext'
import type { ApiError } from '../api/client'
import { useUserId } from '../api/me'
import { boardKey } from '../board/api'
import {
  examsKey,
  materialsKey,
  planKey,
  todayKey,
  type AddedBlock,
  type Block,
  type GenerateResponse,
  type Material,
  type MaterialKind,
  type Shortfall,
  type UnscheduledTask,
} from '../onboarding/api'

// The analysis and materials sections of the exam screen (S15 Task 7): the reads they need, the
// reanalysis and the apply of its draft, and the job remembered across a reload.

export type TaskKind = 'learn' | 'practice' | 'review' | 'simulation' | 'simulation_review' | 'custom'

// GET /exams/{id}/tasks (TaskListItem). The exam screen's task list (Task 6) reads the same query.
export interface ExamTaskItem {
  id: string
  exam_id: string
  title: string
  kind: TaskKind
  estimated_minutes: number
  focus: number
  depends_on_task_id: string | null
  status: 'todo' | 'done' | 'skipped'
  source: 'ai' | 'user'
  created_at: string
  topic_id: string | null
  material_id: string | null
  position: number | null
  reason: string | null
}

// GET /exams/{id}/topics. draft_analysis_id is a reanalysis that waits for the user's approval.
export interface ExamTopics {
  analysis_id: string | null
  draft_analysis_id: string | null
  topics: {
    id: string
    exam_id: string
    name: string
    weight: number
    evidence: string | null
    position: number | null
    analysis_id: string | null
  }[]
  gaps: { topic: string; note: string }[]
}

// POST /analyses/{id}/apply. In a preview version_id is null and basis is what the apply sends back.
export interface AnalysisApply {
  basis: string
  version_id: string | null
  replaced: { id: string; title: string }[]
  kept: number
  added: { task_id: string; title: string; kind: TaskKind; minutes: number; reason: string | null }[]
  added_blocks: AddedBlock[]
  removed_blocks: Block[]
  unscheduled: UnscheduledTask[]
  shortfalls: Shortfall[]
}

// The result of a done reanalyze_exam job: analysis_id is the draft to preview.
export interface ReanalyzeResult {
  analysis_id: string
  exam_id: string
  tasks: number
  topics: number
  gaps: { topic: string; note: string }[]
  warnings: string[]
  dropped: string[]
  total_minutes: number
  budget_minutes: number
}

export const examTasksKey = (userId: string | null, examId: string) => ['tasks', userId, examId] as const
export const topicsKey = (userId: string | null, examId: string) => ['topics', userId, examId] as const

export function useExamTasks(examId: string): UseQueryResult<ExamTaskItem[], ApiError> {
  const api = useApi()
  const userId = useUserId()
  return useQuery<ExamTaskItem[], ApiError>({
    queryKey: examTasksKey(userId, examId),
    queryFn: ({ signal }) => api.get<ExamTaskItem[]>(`/exams/${examId}/tasks`, { signal }),
    enabled: userId !== null,
  })
}

// Live AI tasks: the list holds only live tasks, and every status (todo, done, skipped) counts, since
// they all came from an analysis. Without any the exam offers "בניית תוכנית", with them "ניתוח חוזר".
export function hasAiTasks(tasks: readonly ExamTaskItem[]): boolean {
  return tasks.some((task) => task.source === 'ai')
}

export function useExamTopics(examId: string): UseQueryResult<ExamTopics, ApiError> {
  const api = useApi()
  const userId = useUserId()
  return useQuery<ExamTopics, ApiError>({
    queryKey: topicsKey(userId, examId),
    queryFn: ({ signal }) => api.get<ExamTopics>(`/exams/${examId}/topics`, { signal }),
    enabled: userId !== null,
  })
}

// What a change of the exam's tasks makes stale: its tasks and topics, the board views and the exams.
export function invalidateExamPlan(queryClient: QueryClient, userId: string | null, examId: string) {
  return Promise.all(
    [
      examTasksKey(userId, examId),
      topicsKey(userId, examId),
      planKey(userId),
      todayKey(userId),
      boardKey(userId),
      examsKey(userId),
    ].map(
      (queryKey) => queryClient.invalidateQueries({ queryKey }),
    ),
  )
}

// PATCH /materials/{id} {kind}. The answer replaces the material in its exam's cached list. The kind
// feeds the analysis, not the board (plan decision 8), so nothing else is stale.
export function useUpdateMaterialKind(examId: string) {
  const api = useApi()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<Material, ApiError, { id: string; kind: MaterialKind }>({
    mutationFn: ({ id, kind }) => api.patch<Material>(`/materials/${id}`, { kind }),
    onSuccess: (answer) => {
      queryClient.setQueryData<Material[]>(materialsKey(userId, examId), (list) =>
        list?.map((m) => (m.id === answer.id ? answer : m)),
      )
    },
  })
}

// POST /exams/{id}/reanalyze → the job that writes a draft (created: false = the active one).
export function useReanalyze(examId: string) {
  const api = useApi()
  return useMutation<GenerateResponse, ApiError>({
    mutationFn: () => api.post<GenerateResponse>(`/exams/${examId}/reanalyze`),
  })
}

// POST /analyses/{id}/apply {preview: true}: what applying the draft would change. Nothing is written.
export function useAnalysisPreview(analysisId: string) {
  const api = useApi()
  return useMutation<AnalysisApply, ApiError>({
    mutationFn: () => api.post<AnalysisApply>(`/analyses/${analysisId}/apply`, { preview: true }),
  })
}

// POST /analyses/{id}/apply {preview: false, basis}. stale_plan: the board changed since the preview.
// The refresh is in the hook's own onSuccess, so it runs even when the dialog closed meanwhile.
export function useApplyAnalysis(analysisId: string, examId: string) {
  const api = useApi()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation<AnalysisApply, ApiError, string>({
    mutationFn: (basis) => api.post<AnalysisApply>(`/analyses/${analysisId}/apply`, { preview: false, basis }),
    onSuccess: () => invalidateExamPlan(queryClient, userId, examId),
  })
}

// The job the section follows (a build or a reanalysis), remembered per user and exam in
// sessionStorage, so a reload follows it instead of losing it. Storage may be unavailable (private
// mode, blocked site data): every access is wrapped, and without it the job is only not remembered.
export interface ExamJob {
  jobId: string
  kind: 'generate' | 'reanalyze'
}

const jobStorageKey = (userId: string, examId: string) => `studyflow:exam-job:${userId}:${examId}`

export function rememberExamJob(userId: string | null, examId: string, job: ExamJob): void {
  if (userId === null) return
  try {
    sessionStorage.setItem(jobStorageKey(userId, examId), JSON.stringify(job))
  } catch {
    // Not remembered: a reload shows the buttons again, and the API returns the active job.
  }
}

export function rememberedExamJob(userId: string | null, examId: string): ExamJob | null {
  if (userId === null) return null
  try {
    const raw = sessionStorage.getItem(jobStorageKey(userId, examId))
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const { jobId, kind } = value as Record<string, unknown>
    if (typeof jobId !== 'string' || (kind !== 'generate' && kind !== 'reanalyze')) return null
    return { jobId, kind }
  } catch {
    return null
  }
}

export function forgetExamJob(userId: string | null, examId: string): void {
  if (userId === null) return
  try {
    sessionStorage.removeItem(jobStorageKey(userId, examId))
  } catch {
    // Nothing to forget.
  }
}
