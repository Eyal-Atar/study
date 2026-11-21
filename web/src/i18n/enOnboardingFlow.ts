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
  // What I say while you answer, before I build anything (audit, guideline 9). A first wording:
  // Task 14 of S34 polishes it.
  feasibility: {
    // minutes: the study time from tomorrow until the first exam.
    roomy: (minutes: number, examName: string) =>
      `That gives us ${aboutStudyHours(minutes)} before ${isolate(examName)}. Plenty of room to pace ourselves.`,
    // minutes: the study time for each exam, up to the exam where it gets tight.
    tight: (minutes: number, examName: string) =>
      `That’s ${aboutStudyHours(minutes)} for each exam before ${isolate(examName)}. It’s tight. If you can, one more hour a day would help.`,
    none: (examName: string) =>
      `I can’t find study time before ${isolate(examName)}. Check its date, or your rest days before an exam.`,
  },
} as const
