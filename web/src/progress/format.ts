// Numbers and dates of the progress board, in Hebrew.

const NUMBER = new Intl.NumberFormat('he-IL')

// 10000 → "10,000"
export function formatNumber(n: number): string {
  return NUMBER.format(n)
}

// The calendar date of an instant in `timeZone`, "12 בנובמבר 2026".
export function formatEarnedDate(at: string, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }
  try {
    return new Intl.DateTimeFormat('he-IL', { ...options, timeZone }).format(new Date(at))
  } catch {
    return new Intl.DateTimeFormat('he-IL', options).format(new Date(at))
  }
}

// The weekday of a 'YYYY-MM-DD' date, 0 = Sunday, on the calendar alone.
export function weekdayOf(date: string): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
