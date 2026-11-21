import { isolate } from './bidi'

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
  // Fixed hours read from a photo of the timetable (TimetableImport). A busy time is one row of the
  // proposals: one title at the same hours, on one day or several. `when` is its subtitle
  // ('Wed, 10:00–12:00'), so two rows with the same title still have different names.
  timetable: {
    upload: 'Upload a photo of my timetable',
    uploadRow: 'Update from a photo of my timetable',
    preparing: 'Preparing your photo…',
    reading: 'I’m reading your timetable…',
    found: (n: number) =>
      n === 1
        ? 'I found 1 busy time in your photo. Should I add it?'
        : `I found ${String(n)} busy times in your photo. Should I add them?`,
    approve: (title: string, when: string) => `Add ${isolate(title)}, ${when}`,
    editLabel: 'Edit',
    edit: (title: string, when: string) => `Edit ${isolate(title)}, ${when}`,
    addThem: 'Add them',
    addIt: 'Add it',
    notNow: 'Not now',
    noneChosen: 'Pick at least one busy time for me to add.',
    manual: 'You can mark them yourself.',
    empty: 'I couldn’t find any busy times in this photo.',
    photoTooLarge: 'This photo is too large for me, even after I made it smaller. Try a screenshot of it, or a PDF.',
    photoUnreadable: 'I couldn’t open this photo. Try a JPG or a PNG.',
    // The photos have a daily limit of their own (ai_daily_timetable_limit), apart from the plans.
    quota: (limit: number | null, resetsAt: string | null) =>
      `${limit === null ? 'You’ve reached today’s limit for timetable photos.' : `I can read ${limit === 1 ? '1 timetable photo' : `${String(limit)} timetable photos`} a day, and you’ve reached that.`} ${resetsAt === null ? 'You can try again tomorrow.' : `You can try again after ${resetsAt}.`}`,
  },
} as const
