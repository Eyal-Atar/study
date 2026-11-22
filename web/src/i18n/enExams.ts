import { isolate } from "./bidi";

// The texts of the exams screens that are new in S34: the rows of the exams list. The rest of the
// list (title, count, the empty screen) stays in en.exam.list.
export const enExams = {
  list: {
    // The chip of the days left. The date has passed: no negative count (S34 decision 12).
    chip: (days: number) => {
      if (days < 0) return "Exam day passed";
      if (days === 0) return "Today";
      if (days === 1) return "Tomorrow";
      return `in ${String(days)} days`;
    },
    passed: "Exam day passed",
    progress: (percent: number) => `${String(percent)}% of the plan done`,
    noTasks: "No tasks yet",
    // '16 December 2026. 42% of the plan done'
    rowDetail: (date: string, progress: string) => `${date}. ${progress}`,
    progressLabel: (name: string) => `Progress: ${isolate(name)}`,
  },
} as const;
