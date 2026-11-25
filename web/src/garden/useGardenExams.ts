import { useMemo } from 'react'
import { useExamProgress } from '../calendar/examProgress'
import { examState } from '../closure/types'
import { useExams } from '../onboarding/api'
import type { GardenExam } from './model'

// The live exams of the garden (S33): GET /exams with examState(), each with its percent from the
// tasks the calendar and the exam screen already share (useExamProgress). An exam joins once its
// percent is known. The progress screen's garden and the celebration sheet's before and after.
export function useGardenExams(): GardenExam[] {
  const exams = useExams()
  const open = useMemo(() => (exams.data ?? []).filter((exam) => examState(exam) !== 'done'), [exams.data])
  const percents = useExamProgress(open.map((exam) => exam.id))
  return useMemo(
    () =>
      open.flatMap((exam) => {
        const known = percents.get(exam.id)
        if (known === undefined) return []
        return [
          {
            id: exam.id,
            name: exam.name,
            colorIndex: exam.color_index,
            examDate: exam.exam_date,
            state: examState(exam),
            percent: known.percent,
          },
        ]
      }),
    [open, percents],
  )
}
