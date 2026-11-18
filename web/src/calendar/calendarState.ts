// The history state of a move to the day of the calendar that the user asked for: the "יום" of the
// switch, and "יומן" in the navigation (S31 decision 30). CalendarPage keeps the week on screen
// after a forward move that lost ?view=week (a move of the week screen itself), unless the move
// carries this state. A file of its own, so the shell and the calendar share it without importing
// each other.
export const DAY_CHOSEN = { calendarView: 'day' } as const

export function dayChosen(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { calendarView?: unknown }).calendarView === 'day'
}
