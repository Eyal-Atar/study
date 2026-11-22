// The texts of the calendar screen itself: header, toolbar, states (S32 Task 13). Part of en.calendar (en.ts).
export const enCalendarPage = {
  title: 'Calendar',
  // The one h1 of the screen on a computer, out of sight: the title and the range on screen.
  heading: (range: string | null) => (range === null ? 'Calendar' : `Calendar, ${range}`),
  // The h2 over the banner and the grid, out of sight, so the banner's rows (h3) skip no level.
  planHeading: 'Your plan',
  dateNav: 'Move between dates',
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  previousDay: 'Previous day',
  nextDay: 'Next day',
  // An en dash between the two ends of a range.
  rangeJoin: (first: string, last: string) => `${first}–${last}`,
  stale: 'I couldn’t refresh, so your calendar may be out of date.',
  xp: (xp: number) => `+${String(xp)} XP`,
} as const
