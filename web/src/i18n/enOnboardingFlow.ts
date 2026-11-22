import { isolate } from './bidi'

// The texts of the onboarding conversation and of its live feasibility feedback (S34). Wired into
// en.ts as en.onboardingFlow. Every exam name is user content, so it goes through isolate(), and
// enOnboardingFlow.test.ts has a row for every such call.

// Whole hours, and always "about": the number is an estimate, never a promise. Under half an hour
// it would round to "about 0", which reads as none at all.
const aboutStudyHours = (minutes: number) => {
  const hours = Math.round(minutes / 60)
  if (hours < 1) return 'less than 1 study hour'
  return hours === 1 ? 'about 1 study hour' : `about ${String(hours)} study hours`
}

export const enOnboardingFlow = {
  // The earlier answer of step 1, kept as one quiet line under my question in the later steps
  // ("3 exams: ..."). The names are user content and go in `value`, raw: RecapLine isolates them
  // itself, and a name inside the label would be clipped from the wrong side.
  examsRecap: (names: readonly string[]) => ({
    label: names.length === 1 ? '1 exam:' : `${String(names.length)} exams:`,
    value: names.join(', '),
  }),
  // Step 4 of 4 (S34 decision 4): what I ask about the hours that are already taken.
  fixedHours: {
    question: 'Do you have work, classes or other fixed hours?',
    below: 'Mark your busy hours, and I’ll schedule around them.',
  },
  // Step 3 of 4: the name of the hours control. The question above it is the screen's own.
  schedule: {
    hoursLabel: 'Hours a day',
  },
  // What I say while you answer, before I build anything (audit, guideline 9). The estimate is
  // approximate and errs toward less time, and I have not read the materials yet: so a number is
  // always "about", the study hours are yours ("you", never "us"), and no sentence says the plan
  // fits. Short time is a fact with something you can change next to it, never a fault.
  feasibility: {
    // minutes: the study time from tomorrow until the first exam.
    roomy: (minutes: number, examName: string) =>
      `That gives you ${aboutStudyHours(minutes)} before ${isolate(examName)}. It looks like room for a steady pace.`,
    // minutes: the study time for each exam among those up to examName, itself included, where
    // examName is the earliest exam at which the time gets short. "before" alone would read as
    // the exams that come before it.
    tight: (minutes: number, examName: string) =>
      `That gives you ${aboutStudyHours(minutes)} for each exam up to and including ${isolate(examName)}. It’s tight. If you can, one more hour a day could give you more room.`,
    // No study time at all before examName. More hours a day cannot open a day that has none, so
    // what can change is the date, the study hours (how many and when) and the rest days.
    none: (examName: string) =>
      `I can’t find any study time before ${isolate(examName)} yet. You can change its date, your study hours or your rest days before an exam.`,
  },
} as const
