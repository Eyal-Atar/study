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
  // The dialog that adds or edits one group of busy times (CommitmentDialog).
  dialog: {
    titleAdd: 'What should I keep free every week?',
    titleEdit: 'Edit this busy time',
    name: 'What is it?',
    kind: 'What kind?',
    days: 'Which days?',
    from: 'From',
    to: 'To',
    validUntil: 'Valid until (optional)',
    nameRequired: 'Give it a name so I can tell it apart.',
    daysRequired: 'Pick at least one day.',
    timesRequired: 'Set both times.',
    tooShort: 'A busy time needs at least 15 minutes.',
    sameAsStart: 'The end needs to be different from the start.',
    beforeStart: 'This date is before the busy time starts.',
    saveFailed: 'I couldn’t save all of that. I’ve refreshed the list, so check it and try again.',
    deleteFailed: 'I couldn’t delete all of that. I’ve refreshed the list, so check it and try again.',
  },
} as const
