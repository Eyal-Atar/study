// GET /progress as the API returns it (api/app/schemas/progress.py, plan decision 10). Everything is
// computed on the server from the XP log; the web only shows it.

export type BadgeGroup = 'first' | 'blocks' | 'streak' | 'level' | 'xp'

export interface Badge {
  key: string
  group: BadgeGroup
  // What the group counts: blocks done, the longest streak in study days, the level, or total XP.
  threshold: number
  earned: boolean
  // A UTC instant (ISO), null while not earned.
  earned_at: string | null
}

export interface Streak {
  current: number
  longest: number
  studied_today: boolean
  // 'YYYY-MM-DD', the study day of now in the profile's timezone.
  today: string
}

// An exam closed as done (S45), the garden's blooming plants; from the last closed.
export interface ArchivedExam {
  exam_id: string
  name: string
  color_index: number
  exam_date: string
  first_exam_date: string | null
  sitting: number
  closed_at: string | null
  studied_minutes: number
  tasks_done: number
  tasks_total: number
  completion_percent: number
}

export interface Progress {
  total_xp: number
  level: number
  level_start_xp: number
  // null at the top level.
  next_level_xp: number | null
  max_level: number
  blocks_done: number
  streak: Streak
  // The last 14 study days up to today, oldest first, zeros included.
  days: { date: string; xp: number }[]
  // All the badges in a fixed order, earned or not, so the board shows what comes next.
  badges: Badge[]
  archive: ArchivedExam[]
}
