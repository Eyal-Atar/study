import { Link, useParams } from 'react-router'
import { errorMessage } from '../api/client'
import { useMe } from '../api/me'
import { he } from '../i18n/he'
import { useExams } from '../onboarding/api'
import { Button } from '../ui/Button'
import { AnalysisSection } from './AnalysisSection'
import { useExamPlan, useToday } from './api'
import { ExamHeader } from './ExamHeader'
import { MaterialsSection } from './MaterialsSection'
import { TaskList } from './TaskList'
import { Timeline } from './Timeline'
import { timelineRange } from './timelineDays'

const t = he.exam

const BACK_LINK =
  'inline-flex min-h-11 items-center gap-1 self-start rounded-lg text-sm font-medium text-brand-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand'

function BackLink() {
  return (
    <Link to="/exams" className={BACK_LINK}>
      <svg viewBox="0 0 20 20" aria-hidden="true" className="size-4 rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12.5 4.5 7 10l5.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t.backToList}
    </Link>
  )
}

// /exams/:examId: the exam's header, its days until the exam, its topics and tasks (all editable
// in place), then its materials and analysis (Task 7).
export function ExamPage() {
  const { examId = '' } = useParams()
  const exams = useExams()
  const me = useMe()
  // The header (days left, the date rule) counts calendar days; the timeline counts study days,
  // as GET /plan does.
  const { today, studyDay, timeZone } = useToday()
  const exam = exams.data?.find((e) => e.id === examId)
  const range = timelineRange(studyDay, exam?.exam_date ?? studyDay)
  const plan = useExamPlan(examId, exam === undefined ? null : range.query)

  if (exams.isPending) return <p className="text-ink-muted">{he.common.loading}</p>
  if (exams.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-danger">
          {errorMessage(exams.error)}
        </p>
        <Button
          variant="secondary"
          onPress={() => {
            void exams.refetch()
          }}
        >
          {he.common.retry}
        </Button>
      </div>
    )
  }
  if (exam === undefined) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-ink">{t.notFound}</p>
        <BackLink />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <BackLink />
        <ExamHeader exam={exam} today={today} />
      </div>
      <Timeline
        examId={exam.id}
        examDate={exam.exam_date}
        today={studyDay}
        restDays={me.data?.rest_days_before_exam ?? 0}
        range={range}
        blocks={plan.data?.blocks ?? []}
        error={plan.isError ? plan.error : null}
        onRetry={() => {
          void plan.refetch()
        }}
      />
      <TaskList examId={exam.id} blocks={plan.data?.blocks ?? []} timeZone={timeZone} />
      <MaterialsSection examId={exam.id} />
      <AnalysisSection examId={exam.id} />
    </div>
  )
}
