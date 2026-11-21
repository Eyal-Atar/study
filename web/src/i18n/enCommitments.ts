// The texts of busy-time commitments: the model (groups, days, subtitles), the dialog, the week
// grid and the photo import. Added to as the screens of S34 arrive.
export const enCommitments = {
  defaultTitle: 'Busy',
  kinds: { work: 'Work', class: 'Class', other: 'Other' },
  weekdayShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  weekdayLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  everyDay: 'Every day',
  until: (date: string) => `until ${date}`,
  // The small week where the student marks fixed busy hours (WeekPainter). A cell is named by its
  // day and hour, 'Sunday 10:00'; a saved one says so, since the grid doesn't change it.
  painter: {
    label: 'Your week. Mark the hours you’re busy.',
    cell: (weekday: string, time: string) => `${weekday} ${time}`,
    cellSaved: (weekday: string, time: string) => `${weekday} ${time}, saved`,
  },
} as const
