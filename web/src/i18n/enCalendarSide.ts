// The texts of the sidebar, the day strip, the tasks sheet and the banner (S32 Tasks 11, 12). Part of en.calendar (en.ts).
import { isolate } from './bidi'

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

export const enCalendarSide = {
  // Between the parts of a detail line: "14:00–15:00, 1 hour".
  joiner: ', ',
  freeTime: 'I have free time now',
  markBusy: 'Mark busy time',
  exams: 'Your exams',
  examProgress: (percent: number) => `${String(percent)}% of the plan done`,
  examLabel: (name: string, when: string, percent: number) =>
    `${isolate(name)}, ${when}, ${String(percent)}% of the plan done`,
  peekLeft: (left: number, duration: string) =>
    left === 0 ? 'All done for today' : `${String(left)} left, ${duration}`,
  stripLabel: 'Days of the week',
  stripDay: (weekday: string, day: number, blocks: number) =>
    `${weekday} ${String(day)}, ${blocks === 0 ? 'no blocks' : plural(blocks, 'block', 'blocks')}`,
  banner: {
    review: 'Review',
    report: (count: number) =>
      count === 1 ? 'One task didn’t fit before the exam.' : `${String(count)} tasks didn’t fit before their exams.`,
    details: 'Details',
    close: 'Close',
  },
} as const
