// Availability as the API returns it (S35: api/app/schemas/commitments.py, busy_events.py,
// free_time.py, timetables.py, plan.py BusyOut, blocks.py DeferRequest). Times of day are "HH:MM"
// on the profile's wall clock; instants are UTC ISO strings; dates are "YYYY-MM-DD" local dates.
import type { Block } from '../board/types'

export type CommitmentKind = 'work' | 'class' | 'other'

// 0 = Sunday … 6 = Saturday, like Date.getDay() and the Israeli week.
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

// A weekly commitment: taken time every week on `weekday`, from start_time to end_time (an end
// before the start crosses midnight), for occurrences that start from valid_from to valid_until
// (inclusive; null = no end). The planner never schedules over it.
export interface Commitment {
  id: string
  title: string
  kind: CommitmentKind
  weekday: Weekday
  start_time: string
  end_time: string
  valid_from: string
  valid_until: string | null
  // The timetable job it was approved from, if any.
  source_job_id: string | null
  created_at: string
}

// POST /commitments; valid_from defaults to the profile's local today. At least 15 minutes.
export interface CommitmentInput {
  title: string
  kind: CommitmentKind
  weekday: Weekday
  start_time: string
  end_time: string
  valid_from?: string
  valid_until?: string | null
}

// PATCH /commitments/{id}: any subset, at least one field; only valid_until may be null.
export type CommitmentPatch = Partial<Omit<CommitmentInput, 'valid_until'>> & {
  valid_until?: string | null
}

// A commitment change is a global change: nothing moves until the user approves
// POST /plan/replan (preview, then apply with basis). plan_affected says whether to offer it.
export interface CommitmentWriteResponse {
  commitment: Commitment
  plan_affected: boolean
}

export interface CommitmentDeleteResponse {
  plan_affected: boolean
}

// A one-off busy event ("תפוס" on the calendar), UTC instants on whole minutes, at most 14 days.
export interface BusyEvent {
  id: string
  title: string | null
  starts_at: string
  ends_at: string
  created_at: string
}

export interface BusyEventInput {
  title?: string | null
  starts_at: string
  ends_at: string
}

export type BusyEventPatch = Partial<BusyEventInput>

// A task whose minutes found no new place after an event released its blocks.
export interface UnplacedTask {
  task_id: string
  minutes: number
  reason: string
}

// POST and PATCH /busy-events. Adding an event (or moving it) releases the overlapping blocks and
// places their tasks again; version_id undoes it all with POST /plan/undo (null when only the title
// changed). `blocks` are the live blocks of the tasks that moved.
export interface BusyEventWriteResponse {
  event: BusyEvent
  blocks: Block[]
  unplaced: UnplacedTask[]
  version_id: string | null
}

// Taken time on the calendar, in GET /plan and GET /today: one occurrence of a commitment, or an
// event. Drawn under the study blocks (grey, hatched).
export interface BusyItem {
  source: 'commitment' | 'event'
  id: string
  title: string | null
  kind: CommitmentKind | null
  starts_at: string
  ends_at: string
}

// POST /plan/free-time: "יש לי זמן עכשיו". 30–480 minutes from now; the next tasks move into it,
// pinned. Failure codes: nothing_to_place, no_free_time (409).
export interface FreeTimeResponse {
  session_starts_at: string
  session_ends_at: string
  placed_task_ids: string[]
  blocks: Block[]
  version_id: string | null
}

// POST /blocks/{id}/defer. "next": the next free place (as before); "tomorrow": from the start of
// the next study day; "at": a time from GET /blocks/{id}/slots?date=, pinned.
export type DeferRequest =
  | { to?: 'next'; not_before?: string | null }
  | { to: 'tomorrow' }
  | { to: 'at'; starts_at: string }

// POST /timetables: after uploading the file to the materials bucket at
// `${userId}/timetables/${id}` (id a fresh UUID). Poll GET /jobs/{job_id}.
export interface TimetableRegister {
  id: string
  mime: 'image/jpeg' | 'image/png' | 'application/pdf'
  size_bytes: number
}

export interface TimetableRegisterResponse {
  job_id: string
}

// One proposed commitment in jobs.result of a done parse_timetable job.
export interface TimetableProposal {
  title: string
  kind: CommitmentKind
  weekday: Weekday
  start: string
  end: string
}

export interface TimetableResult {
  commitments: TimetableProposal[]
  model: string
}

// The job's error codes the screen explains: timetable_unreadable, timetable_invalid,
// unsupported_file, file_too_large, too_many_pages, pdf_unreadable, file_missing, ai_* codes.

// POST /timetables/{job_id}/apply: the items the user approved (edited or not, 1–60). valid_from and
// valid_until fill the items that have none (for example the end of the semester).
export interface TimetableApply {
  items: CommitmentInput[]
  valid_from?: string | null
  valid_until?: string | null
}

export interface TimetableApplyResponse {
  commitments: Commitment[]
  plan_affected: boolean
}
