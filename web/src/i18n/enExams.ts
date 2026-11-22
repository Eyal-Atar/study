import { isolate } from './bidi'

// The texts of the exams screens that are new in S34: the rows of the exams list. The rest of the
// list (title, count, the empty screen) stays in en.exam.list.
const PASSED = 'Exam day passed'

export const enExams = {
  list: {
    // The chip of the days left. The date has passed: no negative count (S34 decision 12).
    chip: (days: number) => {
      if (days < 0) return PASSED
      if (days === 0) return 'Today'
      if (days === 1) return 'Tomorrow'
      return `in ${String(days)} days`
    },
    passed: PASSED,
    progress: (percent: number) => `${String(percent)}% of the plan done`,
    noTasks: 'No tasks yet',
    // '16 December 2026. 42% of the plan done'
    rowDetail: (date: string, progress: string) => `${date}. ${progress}`,
    progressLabel: (name: string) => `Progress: ${isolate(name)}`,
  },
  // The exam screen (S34 Task 18): the progress of the plan, the topic tiles, the practice exam.
  exam: {
    timeline: {
      progress: (percent: number) => `${String(percent)}% done`,
    },
    topic: {
      // '1 of 3 tasks done'
      progress: (done: number, total: number) => `${String(done)} of ${String(total)} ${total === 1 ? 'task' : 'tasks'} done`,
      noTasks: 'No tasks yet',
      collapse: (name: string) => `Collapse: ${isolate(name)}`,
      expand: (name: string) => `Expand: ${isolate(name)}`,
    },
    practice: {
      create: 'Create a practice exam',
      // S30 builds it; until then the button is off and says so.
      soon: 'Coming soon',
    },
  },
} as const
