// The texts of the sidebar, the day strip, the tasks sheet and the banner (S32 Tasks 11, 12). Part of en.calendar (en.ts).
import { isolate } from './bidi'
import { inSentence } from './locale'

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

// Between the parts of a detail line: "14:00–15:00, 1 hour".
const JOINER = ', '

export const enCalendarSide = {
  joiner: JOINER,
  freeTime: 'I have free time now',
  markBusy: 'Mark busy time',
  exams: 'Your exams',
  examProgress: (percent: number) => `${String(percent)}% of the plan done`,
  examLabel: (name: string, when: string) => `${isolate(name)}, ${when}`,
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
    // S44: Archi offers, once, to split a task that keeps being deferred into smaller bites.
    // Every number comes from the offer of the server (parts, bite_minutes, block.minutes): none is fixed here.
    split: {
      say: (title: string, blockMinutes: number, biteMinutes: number) =>
        `I noticed we keep pushing ${isolate(title)} back. Want me to split this ${String(blockMinutes)}-minute block into ${String(biteMinutes)}-minute bites instead?`,
      show: 'Show me',
      // even: every part is one bite long ("Split into 3×30m"); else only the length of a bite is named.
      action: (count: number, biteMinutes: number, even: boolean) =>
        even ? `Split into ${String(count)}×${String(biteMinutes)}m` : `Split into ${String(biteMinutes)}m bites`,
      notNow: 'Not now',
      where: (count: number) =>
        count === 1 ? 'Here’s where the bite would go:' : `Here’s where the ${String(count)} bites would go:`,
      // One part of the list: "Tue, 24 Nov, 18:00–18:30, 30 min".
      part: (day: string, range: string, duration: string) => [day, range, duration].join(JOINER),
      // When the split takes every block of the task that has not started yet, not only the deferred one.
      whole: (duration: string) => `That’s every block of this task that’s still ahead, ${duration} in all.`,
      // day: "Today", "Tomorrow" or a short date ("Sun, 22 Nov"), as dayLabel gives it.
      done: (count: number, day: string, time: string) =>
        count === 1
          ? `I split it into ${plural(count, 'bite', 'bites')}. It’s ${inSentence(day)} at ${time}.`
          : `I split it into ${plural(count, 'bite', 'bites')}. The first is ${inSentence(day)} at ${time}.`,
      undone: 'I put the block back as it was.',
      dismissed: 'I’ll leave it as it is.',
      stale: 'Your plan changed, so I looked again.',
    },
  },
} as const
