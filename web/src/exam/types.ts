// The shapes the exam screen reads from the API (api/app/schemas/tasks.py, topics, plan). Ids are UUID
// strings, dates 'YYYY-MM-DD', and times ISO 8601 with an offset.

import type { Block } from '../onboarding/types'

export type TaskKind = 'learn' | 'practice' | 'review' | 'simulation' | 'simulation_review' | 'custom'
export type TaskStatus = 'todo' | 'done' | 'skipped'

export const TASK_KINDS: readonly TaskKind[] = ['learn', 'practice', 'review', 'simulation', 'simulation_review', 'custom']

export interface Task {
  id: string
  exam_id: string
  title: string
  kind: TaskKind
  estimated_minutes: number
  focus: number
  depends_on_task_id: string | null
  status: TaskStatus
  source: 'ai' | 'user'
  created_at: string
  topic_id: string | null
  material_id: string | null
  position: number | null
}

// GET /exams/{id}/tasks: each task with the analysis's reason for it (null for a user task).
export interface ExamTask extends Task {
  reason: string | null
}

export interface TaskCreate {
  exam_id: string
  title: string
  kind: TaskKind
  estimated_minutes: number
  focus?: number
  topic_id?: string | null
}

// PATCH /tasks/{id}: only the fields that changed. null removes a topic.
export type TaskPatch = Partial<Pick<Task, 'title' | 'kind' | 'estimated_minutes' | 'focus' | 'status' | 'topic_id'>>

// How the server placed the task on the board. placed false: the fields were saved, the board did
// not change (spec 7.6 step 8), so the screen offers a replan.
export interface Placement {
  placed: boolean
  reason: string | null
  blocked_by: string | null
}

// POST /tasks and PATCH /tasks/{id}. PATCH answers placement null when the task was not re-placed.
export interface TaskWriteResponse {
  task: Task
  placement: Placement | null
  version_id: string | null
}

export interface TaskDeleteResponse {
  version_id: string | null
}

export interface Topic {
  id: string
  exam_id: string
  name: string
  weight: number
  evidence: string | null
  position: number | null
  analysis_id: string | null
}

export interface Gap {
  topic: string
  note: string
}

// GET /exams/{id}/topics.
export interface TopicsResponse {
  analysis_id: string | null
  draft_analysis_id: string | null
  topics: Topic[]
  gaps: Gap[]
}

export type TopicPatch = Partial<Pick<Topic, 'name' | 'weight'>>

// GET /plan?from&to.
export interface PlanResponse {
  from: string
  to: string
  blocks: Block[]
  unplaced: { task_id: string; exam_id: string; title: string; minutes: number }[]
  undo: { version_id: string; reason: string; created_at: string } | null
}
