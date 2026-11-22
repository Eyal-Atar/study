import type { ExamTask } from './types'

// The progress of an exam (S34 decision 11): the minutes of the tasks that are done, out of the
// minutes of every task that was not skipped. No such tasks is 0 of 0 and 0%.
export function examProgress(tasks: ExamTask[]): {
  done: number
  total: number
  percent: number
} {
  let done = 0
  let total = 0
  for (const task of tasks) {
    if (task.status === 'skipped') continue
    total += task.estimated_minutes
    if (task.status === 'done') done += task.estimated_minutes
  }
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  }
}
