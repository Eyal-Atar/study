// The texts of the server codes of the calendar. Part of en.codes (en.ts).
// S35: availability, through the calendar (S32) and the settings (S34). S44: the split offer of the banner.
export const enCalendarCodes = {
  slot_busy: 'That time overlaps busy time in your calendar.',
  event_in_past: 'That time has already passed.',
  too_many_events: 'You have too many upcoming events. Delete one to add another.',
  not_after_starts_at: 'The end time needs to come after the start time.',
  too_long: 'Busy time can be up to 14 days long.',
  nothing_to_place: 'I don’t have a task I can bring forward right now.',
  no_free_time: 'That time is already taken in your calendar.',
  too_many_commitments: (limit: number | null) =>
    limit === null
      ? 'You’ve reached the limit of weekly busy times. Delete one to add another.'
      : `You can have up to ${String(limit)} weekly busy times. Delete one to add another.`,
  too_short: 'A busy time needs to be at least 15 minutes long.',
  range_too_long: 'That’s too long a range for me to show at once.',
  already_applied: 'I’ve already saved that timetable.',
  job_not_ready: 'I haven’t finished reading that yet. Give me a moment.',
  timetable_unreadable: 'I couldn’t read a timetable in that file. Try a sharper photo or a PDF.',
  timetable_invalid: 'I couldn’t make sense of that timetable. Try again, or add your busy times by hand.',
  too_many_pages: 'That PDF has too many pages. Send me only the page with your timetable.',
  // S44: the offer is gone (split, dismissed, or the task is no longer deferred that often).
  no_split_offer: 'I don’t have a split to offer for this task right now.',
} as const
