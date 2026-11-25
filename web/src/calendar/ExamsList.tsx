import { examState, type ExamState } from '../closure/types'
import { daysBetween } from '../exam/dates'
import { en } from '../i18n/en'
import { ExamProgressBar } from '../ui/ExamMark'
import { examColor } from '../ui/examColor'
import { SectionHeading } from '../ui/SectionHeading'
import { cx } from '../ui/styles'
import { UserText } from '../ui/UserText'
import { useExamProgress } from './examProgress'

export interface SidebarExam {
  id: string
  name: string
  exam_date: string
  color_index: number
  // S45: only an active exam is still ahead; one closed on its day (or waiting for Moed B) is not.
  state?: ExamState | undefined
}

const MAX_EXAMS = 4

// The coming exams, the nearest first (the .examrow of the prototype): the colour that marks the
// exam's blocks on the calendar, its name, how far it is, and how much of its plan is done. An exam
// that passed, or that was closed (S45, also on its own day), is not here, and with no coming exam
// there is nothing at all.
export function ExamsList({ exams, today }: { exams: SidebarExam[]; today: string }) {
  const coming = exams
    .filter((exam) => examState(exam) === 'active' && exam.exam_date >= today)
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date))
    .slice(0, MAX_EXAMS)
  const progress = useExamProgress(coming.map((exam) => exam.id))
  if (coming.length === 0) return null
  return (
    <div>
      <SectionHeading level={3} className="mb-2">
        {en.calendar.side.exams}
      </SectionHeading>
      <ul className="flex flex-col gap-2.5">
        {coming.map((exam) => {
          // Until the tasks arrive: 0 of 0, an empty bar.
          const shown = progress.get(exam.id) ?? { done: 0, total: 0, percent: 0 }
          const when = en.exam.inDays(daysBetween(today, exam.exam_date))
          return (
            <li key={exam.id} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
              <span aria-hidden="true" className={cx('size-2.5 rounded-[3px]', examColor(exam.color_index).solid)} />
              <UserText truncate className="text-small font-medium">
                {exam.name}
              </UserText>
              <span className="text-small text-ink-muted tabular-nums">{when}</span>
              <div className="col-start-2 col-end-[-1]">
                {/* The name is the exam and its days, the value the sentence: the percent is heard once. */}
                <ExamProgressBar
                  colorIndex={exam.color_index}
                  value={shown.done}
                  max={shown.total}
                  aria-label={en.calendar.side.examLabel(exam.name, when)}
                  valueText={en.calendar.side.examProgress(shown.percent)}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
