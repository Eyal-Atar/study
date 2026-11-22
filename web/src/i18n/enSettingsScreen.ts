// The texts of the settings screen of S34 (the sections as cards) and the account deletion. Added to
// as the sections arrive.
export const enSettingsScreen = {
  // The Busy time card (CommitmentsSection): the student's fixed weekly hours, a row per group.
  busy: {
    title: 'Busy time',
    add: 'Add',
    empty: 'Nothing here yet. Add your work, classes or other fixed hours, and I’ll schedule around them.',
    removed: 'Busy time removed',
    undoFailed: 'I couldn’t bring all of it back. I’ve refreshed the list, so check it and add what’s missing.',
    replanReason: 'Your busy time changed. Should I update your plan to match?',
  },
  // The rows of Study preferences (PreferencesForm) and the account card. The row title is the
  // name of what the row opens; its summary is the current value.
  prefs: {
    hours: 'Hours a day',
    when: 'When you study',
    meTime: 'Me time every day',
    rest: 'Rest days before an exam',
    day: 'Your day',
    delay: 'Time before you start studying',
    off: 'Off',
    tooManyBusy: 'You already have as many busy times as I can hold. Remove one, and I’ll save your Me time.',
    accountTitle: 'Account',
  },
} as const
