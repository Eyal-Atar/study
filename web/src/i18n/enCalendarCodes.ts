// The texts of the S35 server codes: availability, through the calendar (S32) and the settings (S34). Part of en.codes (en.ts).
export const enCalendarCodes = {
  slot_busy: 'That time falls on busy time in your calendar.',
  event_in_past: 'Busy time can only be marked from now on.',
  too_many_events: 'You have too many upcoming events. Delete one to add another.',
  not_after_starts_at: 'The end time needs to come after the start time.',
  too_long: 'Busy time can be up to 14 days long.',
  nothing_to_place: 'I don’t have a task I can bring forward right now.',
  no_free_time: 'That time is already taken in your calendar.',
  too_many_commitments: (limit: number | null) =>
    limit === null
      ? 'You’ve reached the limit of weekly commitments. Delete one to add another.'
      : `You can have up to ${String(limit)} weekly commitments. Delete one to add another.`,
  too_short: 'A commitment needs to be at least 15 minutes long.',
  range_too_long: 'That’s too long a range for me to show at once.',
  already_applied: 'I’ve already saved that timetable.',
  job_not_ready: 'I haven’t finished reading that yet. Give me a moment.',
  timetable_unreadable: 'I couldn’t read a timetable in that file. Try a sharper photo or a PDF.',
  timetable_invalid: 'I couldn’t make sense of that timetable. Try again, or add your commitments by hand.',
  too_many_pages: 'That PDF has too many pages. Send me only the page with your timetable.',
} as const
