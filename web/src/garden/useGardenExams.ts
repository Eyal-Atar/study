import { useMemo } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useExamProgress } from '../calendar/examProgress'
import { examState } from '../closure/types'
import { tasksKey } from '../exam/api'
import { examProgress } from '../exam/examProgress'
import type { ExamTask } from '../exam/types'
import { useExams } from '../onboarding/api'
import type { Exam } from '../onboarding/types'
import type { GardenExam } from './model'

// The live exams of the garden (S33): GET /exams with examState(), each with its percent from its
// tasks (the formula of the exams screen). An exam joins once its percent is known.
export function gardenExamsOf(exams: Exam[], percentOf: (examId: string) => number | undefined): GardenExam[] {
  return exams.flatMap((exam) => {
    const state = examState(exam)
    if (state === 'done') return []
    const percent = percentOf(exam.id)
    if (percent === undefined) return []
    return [{ id: exam.id, name: exam.name, colorIndex: exam.color_index, examDate: exam.exam_date, state, percent }]
  })
}

// The progress screen's garden: it observes GET /exams and the tasks of each open exam, through the
// queries the calendar and the exam screen already share (useExamProgress).
export function useGardenExams(): GardenExam[] {
  const exams = useExams()
  const open = useMemo(() => (exams.data ?? []).filter((exam) => examState(exam) !== 'done'), [exams.data])
  const percents = useExamProgress(open.map((exam) => exam.id))
  return useMemo(() => gardenExamsOf(open, (id) => percents.get(id)?.percent), [open, percents])
}

// The celebration sheet's before and after: only what the cache already holds, with no observer and
// so no request (the sheet asks the server nothing). An exam whose tasks were never loaded is left out
// of both scenes alike.
export function cachedGardenExams(queryClient: QueryClient, userId: string | null, exams: Exam[]): GardenExam[] {
  return gardenExamsOf(exams, (id) => {
    const tasks = queryClient.getQueryData<ExamTask[]>(tasksKey(userId, id))
    return tasks === undefined ? undefined : examProgress(tasks).percent
  })
}
