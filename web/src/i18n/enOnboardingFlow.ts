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
    // The two answers. "No" goes on to the build at once; "Yes" opens the small week.
    no: 'No, I’m flexible',
    yes: 'Yes, I do',
    addExact: 'Add exact hours',
    // The busy times already saved, under the week. A group's delete button is named by its title
    // (user content) and its days and hours, so two groups with one title still differ.
    savedLabel: 'Your busy times',
    remove: (title: string, when: string) => `Delete: ${isolate(title)}, ${when}`,
    removeFailed: 'I couldn’t delete that busy time. I’ve refreshed the list, so check it and try again.',
    // "Build my plan" after some of the marked hours didn't save. What saved shows as saved; the
    // rest stays marked, and the next press sends only that.
    saveFailed: 'I couldn’t save all your busy hours. The ones still marked aren’t saved yet, so you can try again.',
    // A file removed in step 2 that the server didn't delete: it's back there, so the build waits.
    deletesFailed: 'I couldn’t delete a file you removed from your materials. Go back to check it, then try again.',
  },
  // Step 3 of 4: the name of the hours control. The question above it is the screen's own.
  schedule: {
    hoursLabel: 'Hours a day',
  },
  // What I say while you answer, before I build anything (audit, guideline 9). The estimate is
  // approximate and errs toward less time, and I have not read the materials yet: so a number is
  // always "about", the study hours are yours ("you", never "us"), and no sentence says the plan
  // fits. Short time is a fact with something you can change next to it, never a fault. The note
  // does not know which limit was hit, so the advice names only what can add time in every state
  // that reaches it, with "could" and without a number.
  feasibility: {
    // minutes: the study time from tomorrow until the first exam.
    roomy: (minutes: number, examName: string) =>
      `That gives you ${aboutStudyHours(minutes)} before ${isolate(examName)}. It looks like there’s room for a steady pace.`,
    // examName is the earliest exam at which the time gets short, examCount the exams up to it,
    // itself included, and minutes the study time for each of them. With one exam it is simply the
    // time before it. With several, "before" alone would read as the exams that come before it.
    // The hours a day and the time of day are the two answers that can add time: which of them is
    // the limit is not known here, and the hour choices are not one hour apart.
    tight: (minutes: number, examName: string, examCount = 1) => {
      const advice = 'It’s tight. More hours a day, or another time of day to study, could give you more room.'
      return examCount === 1
        ? `That gives you ${aboutStudyHours(minutes)} before ${isolate(examName)}. ${advice}`
        : `That gives you ${aboutStudyHours(minutes)} for each exam up to and including ${isolate(examName)}. ${advice}`
    },
    // No study time at all before examName. The likeliest cause is the date, so I ask about it.
    // More hours a day cannot open a day that has none; another time of day can. The rest days
    // are not on the onboarding screens (they default to 1), so I say where they are.
    none: (examName: string) =>
      `I can’t find any study time before ${isolate(examName)} yet. Is its date right? If it is, another time of day to study could open some up. You can also change your rest days before an exam later, in Settings.`,
  },
  // The build and the plan that comes out of it are not numbered steps (S34 decision 4).
  build: {
    // The name of the list of the five stages of the build.
    stagesLabel: 'What I’m doing now',
    // Said once by the live region when the stage changes; the list shows the same words, so the
    // live text carries a lead-in and is not a second copy of them.
    now: (stage: string) => `Now: ${stage}`,
  },
  ready: {
    // One sentence: what I placed and, when an exam is ahead, how far the nearest one is.
    summary: (blocks: number, daysToFirstExam: number | null) => {
      const placed = `I placed ${blocks === 1 ? '1 study block' : `${String(blocks)} study blocks`} on your calendar.`
      if (daysToFirstExam === null) return placed
      const when = daysToFirstExam === 0 ? 'today' : daysToFirstExam === 1 ? 'tomorrow' : `in ${String(daysToFirstExam)} days`
      return `${placed} Your first exam is ${when}.`
    },
    // The gold chip. Shown only when the server really gave the XP; the number comes from the job.
    xpChip: (xp: number) => `+${String(xp)} XP`,
    xpChipLabel: (xp: number) => `I gave you ${String(xp)} XP for your first plan`,
    seedChip: 'The first seed in your garden',
  },
} as const
