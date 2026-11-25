import { useId } from 'react'
import { durationText } from '../board/time'
import { longDate, todayIn } from '../exam/dates'
import { en } from '../i18n/en'
import { Card } from '../ui/Card'
import { ExamInitial } from '../ui/ExamMark'
import { List, ListRow } from '../ui/List'
import { SectionHeading } from '../ui/SectionHeading'
import { UserText } from '../ui/UserText'
import type { ArchivedExam } from './types'

const t = en.closure.progress

// The line of the date: the day of the closure in the user's zone, or the day of the exam when the
// closure has no moment. Moed B says so first.
function closedLine(exam: ArchivedExam, timeZone: string): string {
  const day = exam.closed_at === null ? exam.exam_date : todayIn(timeZone, new Date(exam.closed_at))
  const line = t.closedOn(longDate(day))
  return exam.sitting === 2 ? en.closure.list.moedB(line) : line
}

// The exams closed as done (S45), in the order of the server. The garden (S33) draws from the same
// `archive`; nothing of it is here.
export function ArchiveList({ archive, timeZone }: { archive: ArchivedExam[]; timeZone: string }) {
  const titleId = useId()
  if (archive.length === 0) return null
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <SectionHeading id={titleId} level={2}>
        {t.title}
      </SectionHeading>
      <Card>
        <List aria-label={t.title}>
          {archive.map((exam) => (
            <ListRow
              key={exam.exam_id}
              to={`/exams/${exam.exam_id}`}
              leading={<ExamInitial name={exam.name} colorIndex={exam.color_index} />}
              title={<UserText>{exam.name}</UserText>}
              subtitle={
                <span className="flex flex-col tabular-nums">
                  <span>{closedLine(exam, timeZone)}</span>
                  <span>{t.summary(durationText(exam.studied_minutes), exam.completion_percent)}</span>
                </span>
              }
            />
          ))}
        </List>
      </Card>
    </section>
  )
}
