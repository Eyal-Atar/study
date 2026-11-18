// The board as the API returns it (api/app/schemas/plan.py, blocks.py, exams.py). Times are UTC
// instants (ISO strings); `study_date` is the day in the profile's timezone, decided by the server.
import type { BusyItem } from '../availability/types'

export type TaskKind = 'learn' | 'practice' | 'review' | 'simulation' | 'simulation_review' | 'custom'

export type BlockStatus = 'planned' | 'done' | 'missed' | 'skipped'

// Derived on the server from `status` and `now`: a planned block is upcoming, in_progress or overdue.
export type BlockState = 'upcoming' | 'in_progress' | 'overdue' | 'done' | 'missed' | 'skipped'

export interface Block {
  id: string
  task_id: string
  exam_id: string
  task_title: string
  task_kind: TaskKind
  exam_name: string
  starts_at: string
  ends_at: string
  study_date: string
  part_index: number
  part_count: number
  pinned: boolean
  status: BlockStatus
  state: BlockState
}

// GET /today
export interface Today {
  date: string
  blocks: Block[]
  planned_minutes: number
  done_minutes: number
  // S18: from wake_time to sleep_time of today's study day (UTC instants), the span a block can be
  // moved within; null when the profile leaves no waking time that day.
  day_starts_at: string | null
  day_ends_at: string | null
  // S35: commitment occurrences and busy events over the day's waking hours. The server always
  // sends it; optional until the screens of S32 read it and their fixtures carry it.
  busy?: BusyItem[]
}

// A task that is not on the board (GET /plan). The reason comes only from the replan preview.
export interface Unplaced {
  task_id: string
  exam_id: string
  title: string
  minutes: number
}

// The last plan version that can still be undone.
export interface UndoInfo {
  version_id: string
  reason: string
  created_at: string
}

// GET /plan?from=&to=
export interface Plan {
  from: string
  to: string
  blocks: Block[]
  unplaced: Unplaced[]
  undo: UndoInfo | null
  // S35: commitment occurrences and busy events over the waking hours of the range (see Today).
  busy?: BusyItem[]
}

export interface Unscheduled {
  task_id: string
  minutes: number
  reason: string
  blocked_by: string | null
}

export interface Shortfall {
  exam_id: string
  minutes: number
  daily_minutes: number | null
}

export interface AddedBlock {
  task_id: string
  starts_at: string
  ends_at: string
  part_index: number
  part_count: number
}

// POST /plan/replan {preview: true}: writes nothing.
export interface ReplanPreview {
  basis: string
  changed: boolean
  version_id: string | null
  added: AddedBlock[]
  removed: Block[]
  unscheduled: Unscheduled[]
  shortfalls: Shortfall[]
  warnings: string[]
}

// GET /exams returns ExamOut (id, name, exam_date, difficulty, created_at); the board needs the name.
export interface ExamSummary {
  id: string
  name: string
}

// POST /blocks/{id}/complete and /uncomplete
// S19: what one complete or uncomplete changed in XP, level and badges (api/app/schemas/progress.py).
export interface ProgressChange {
  xp_change: number
  total_xp: number
  level: number
  level_up: boolean
  badges_earned: string[]
  badges_lost: string[]
}

export interface CompleteResult {
  block: Block
  task_status: string
  // Absent only from an API older than S19.
  progress?: ProgressChange
}

// POST /blocks/{id}/defer: the task's done blocks and its planned blocks that did not end yet.
export interface DeferResult {
  blocks: Block[]
  version_id: string | null
}

// S18 GET /review: planned blocks that ended without a mark, of todo tasks, from the last 7 study days.
export interface Review {
  blocks: Block[]
}

// S18 POST /blocks/{id}/reschedule {today_only}: the task's done and live planned blocks, and the version.
export type RescheduleResult = DeferResult

// S18 POST /blocks/{id}/skip: the task is skipped, its open blocks are gone.
export interface SkipResult {
  task_status: string
  version_id: string | null
}

// S18 GET /blocks/{id}/slots: every start on the local 15-minute grid the block can move to.
export interface Slots {
  study_date: string
  day_starts_at: string | null
  day_ends_at: string | null
  slots: string[]
}
