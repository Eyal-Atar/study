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
} as const
