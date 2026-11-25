// The shapes the onboarding reads from the API (api/app/schemas/*.py). Ids are UUID strings,
// dates 'YYYY-MM-DD', and times ISO 8601 with an offset.

export type { Me, StudyWindow } from '../api/me'
import type { ExamState } from '../closure/types'

export interface Exam {
  id: string
  name: string
  exam_date: string
  difficulty: number
  created_at: string
  // 0-7, the colour of the exam (S31): the server gives each exam a stable one; see ui/examColor.ts.
  color_index: number
  // S45: the server always sends these. Optional so that test data from before S45 works; every read of
  // the state goes through examState() (closure/types.ts).
  sitting?: number
  state?: ExamState
  closed_at?: string | null
  first_exam_date?: string | null
  first_grade?: number | null
}

export interface ExamCreate {
  name: string
  exam_date: string
  difficulty: number
}

// POST /exams and PATCH /exams/{id}.
export interface ExamResponse {
  exam: Exam
  plan_affected: boolean
}

// DELETE /exams/{id}: version_id is what POST /plan/undo takes back, null when no plan was touched.
export interface ExamDeleteResponse {
  version_id: string | null
  plan_affected: boolean
}

export type MaterialKind = 'syllabus' | 'summary' | 'past_exam' | 'solution' | 'notes' | 'other'
export type MaterialMime = 'application/pdf' | 'image/jpeg' | 'image/png'
export type IngestStatus = 'queued' | 'processing' | 'ready' | 'failed'

export interface Material {
  id: string
  exam_id: string
  filename: string
  kind: MaterialKind
  mime: string
  size_bytes: number
  page_count: number | null
  scanned_pages: number | null
  ingest_status: IngestStatus
  ingest_error: string | null
  warnings: string[]
  created_at: string
  ingested_at: string | null
}

export interface MaterialRegister {
  id: string
  filename: string
  kind: MaterialKind
  mime: MaterialMime
  size_bytes: number
}

export interface MaterialRegisterResponse {
  material: Material
  job_id: string
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface Job<R = Record<string, unknown>> {
  id: string
  kind: string
  status: JobStatus
  stage: string | null
  percent: number | null
  error: string | null
  result: R | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

// POST /plans/generate: created is false when an active job was returned instead of a new one.
export interface GenerateResponse {
  job_id: string
  created: boolean
}

export interface Shortfall {
  exam_id: string
  minutes: number
  daily_minutes: number | null
}

export interface ExamGeneration {
  exam_id: string
  status: 'analyzed' | 'failed' | 'skipped'
  error?: string
  analysis_id?: string
  topics: number
  tasks: number
  gaps: { topic: string; note: string }[]
  warnings: string[]
  dropped: string[]
  total_minutes: number
  budget_minutes: number
}

// The result of a done generate_plan job (api/app/jobs/plan_jobs.py).
export interface GenerateResult {
  exams: ExamGeneration[]
  plan: {
    version_id: string | null
    blocks: number
    // Cut to fit the result column; unscheduled_count is the whole count.
    unscheduled: { task_id: string; reason: string }[]
    unscheduled_count: number
    shortfalls: Shortfall[]
    warnings: string[]
  }
  // 50 only in the job that gave the first plan's XP; absent in jobs from before S34, read as 0.
  first_plan_xp?: number
}

export interface UnscheduledTask {
  task_id: string
  minutes: number
  reason: string
  blocked_by: string | null
}

export interface AddedBlock {
  task_id: string
  starts_at: string
  ends_at: string
  part_index: number
  part_count: number
}

export interface Block {
  id: string
  task_id: string
  exam_id: string
  task_title: string
  task_kind: string
  exam_name: string
  starts_at: string
  ends_at: string
  study_date: string
  part_index: number
  part_count: number
  pinned: boolean
  status: string
  state: string
}

// POST /plan/replan. In a preview version_id is null and basis is what an apply must send back.
export interface ReplanPreview {
  basis: string
  changed: boolean
  version_id: string | null
  added: AddedBlock[]
  removed: Block[]
  unscheduled: UnscheduledTask[]
  shortfalls: Shortfall[]
  warnings: string[]
}

export interface UndoResponse {
  restored: number
  deleted: number
  replaced: string[]
  unplaced: UnscheduledTask[]
}
