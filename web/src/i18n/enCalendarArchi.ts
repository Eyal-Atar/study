// The texts of what Archi says on the calendar, a few wordings for each moment (S32 Tasks 2, 6). Part of en.calendar (en.ts).
const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

export const enCalendarArchi = {
  // Three wordings for each fixed moment, so the same day does not always open with the same line.
  review: [
    'Before we start, there’s a block from earlier I’d like to sort with you.',
    'Let’s look at yesterday first, then today.',
    'One thing from before today needs an answer. Then we go on.',
  ],
  report: [
    'Something didn’t fit before the exam. I’ve laid it out for you.',
    'I couldn’t fit everything in. Take a look when you have a minute.',
    'Your plan is a little too full. I have a way out to suggest.',
  ],
  restDay: [
    'Nothing is planned for today. Enjoy the quiet.',
    'Today is a free day. I’ve put the kettle on.',
    'No blocks today. Rest is part of the plan.',
  ],
  dayDone: [
    'That’s every block for today. Well done.',
    'Today is complete. The rest of the day is yours.',
    'You finished today’s plan. I’ll see you tomorrow.',
  ],
  deepWork: [
    'A long block is under way. I’ll keep quiet.',
    'You’re in the middle of a long one. Take it page by page.',
    'Deep work now. I’m right here.',
  ],
  // Up to three sentences: what is set for today, what is done, and when the next block starts.
  summary: (total: number, done: number, next: string | null) =>
    [
      `I’ve set ${plural(total, 'block', 'blocks')} for today.`,
      ...(done > 0 ? [`${String(done)} ${done === 1 ? 'is' : 'are'} done.`] : []),
      ...(next === null ? [] : [`The next starts at ${next}.`]),
    ].join(' '),
  breakTitle: 'That was 90 minutes in a row. I’ve poured the tea.',
  breakBody: (next: string | null) =>
    next === null
      ? 'Take five minutes away from the screen.'
      : `Take five minutes away from the screen. Your next block is at ${next}.`,
  breakClose: 'Close',
} as const
