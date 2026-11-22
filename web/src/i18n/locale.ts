// The one locale of the product (S39). The language is English; the region is Israel, so Intl and
// React Aria give a 24-hour clock ("16:05"), day before month ("22 November 2026", "Sun, 22 Nov")
// and a week that starts on Sunday. en-US would give a 12-hour clock, en-GB a week from Monday.
export const LOCALE = 'en-IL'

// "Today", "Tomorrow" and "Yesterday" are titles on their own and lower case inside a sentence
// ("I moved it to tomorrow at 14:00."); a date ("Sun, 22 Nov") stays as it is.
export const inSentence = (day: string) => (/^(Today|Tomorrow|Yesterday)$/.test(day) ? day.toLowerCase() : day)
