import { en } from '../i18n/en'
import type { Task, TaskKind, TaskPatch } from './types'

const t = en.exam.tasks

// The API's limits (TaskCreate / TaskPatch in api/app/schemas/tasks.py).
const TITLE_MAX = 200
const MINUTES_MIN = 5
const MINUTES_MAX = 600
const FOCUS_MIN = 1
const FOCUS_MAX = 10

// The form's fields as typed. topicId '' is "בלי נושא".
export interface TaskDraft {
  title: string
  minutes: string
  focus: string
  kind: TaskKind
  topicId: string
}

export interface TaskDraftErrors {
  title?: string | undefined
  minutes?: string | undefined
  focus?: string | undefined
}

export const emptyErrors: TaskDraftErrors = {}

export interface TaskValues {
  title: string
  minutes: number
  focus: number
  kind: TaskKind
  topicId: string | null
}

export function draftOfTask(task: Task): TaskDraft {
  return {
    title: task.title,
    minutes: String(task.estimated_minutes),
    focus: String(task.focus),
    kind: task.kind,
    topicId: task.topic_id ?? '',
  }
}

export const NEW_TASK_DRAFT: TaskDraft = { title: '', minutes: '30', focus: '5', kind: 'custom', topicId: '' }

function integerIn(text: string, min: number, max: number): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value >= min && value <= max ? value : null
}

export function validateTask(draft: TaskDraft, withFocus: boolean): { errors: TaskDraftErrors; values: TaskValues | null } {
  const errors: TaskDraftErrors = {}
  const title = draft.title.trim()
  if (title === '' || title.length > TITLE_MAX) errors.title = t.titleRequired
  const minutes = integerIn(draft.minutes, MINUTES_MIN, MINUTES_MAX)
  if (minutes === null) errors.minutes = t.minutesRange
  const focus = withFocus ? integerIn(draft.focus, FOCUS_MIN, FOCUS_MAX) : 5
  if (focus === null) errors.focus = t.focusRange
  if (errors.title !== undefined || minutes === null || focus === null) return { errors, values: null }
  return { errors, values: { title, minutes, focus, kind: draft.kind, topicId: draft.topicId === '' ? null : draft.topicId } }
}

// Only what changed: an unchanged form sends no request.
export function taskPatch(task: Task, values: TaskValues): TaskPatch {
  const patch: TaskPatch = {}
  if (values.title !== task.title) patch.title = values.title
  if (values.minutes !== task.estimated_minutes) patch.estimated_minutes = values.minutes
  if (values.focus !== task.focus) patch.focus = values.focus
  if (values.kind !== task.kind) patch.kind = values.kind
  if (values.topicId !== task.topic_id) patch.topic_id = values.topicId
  return patch
}
