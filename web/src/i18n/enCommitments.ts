// The texts of busy-time commitments: the model (groups, days, subtitles), the dialog, the week
// grid and the photo import. Added to as the screens of S34 arrive.
export const enCommitments = {
  defaultTitle: 'Busy',
  kinds: { work: 'Work', class: 'Class', other: 'Other' },
  weekdayShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  weekdayLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  everyDay: 'Every day',
  until: (date: string) => `until ${date}`,
} as const
