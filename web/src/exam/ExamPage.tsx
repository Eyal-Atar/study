import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router'
import { errorMessage } from '../api/client'
import { useMe } from '../api/me'
import { he } from '../i18n/he'
import { useExams } from '../onboarding/api'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/states'
import { ICON_STROKE } from '../ui/styles'
import { TextLink } from '../ui/TextLink'
import { AnalysisSection } from './AnalysisSection'
import { useExamPlan, useToday } from './api'
import { ExamHeader } from './ExamHeader'
import { MaterialsSection } from './MaterialsSection'
import { TaskList } from './TaskList'
import { Timeline } from './Timeline'
import { timelineRange } from './timelineDays'

const t = he.exam

// In RTL "back" points right, so the chevron needs no flip.
function BackLink() {
  return (
    <TextLink to="/exams" className="inline-flex min-h-touch items-center gap-1 self-start text-small">
      <ChevronRight aria-hidden="true" size={16} strokeWidth={ICON_STROKE} />
      {t.backToList}
    </TextLink>
  )
}

// The screen before the exam itself is known: the same back link and an h1 at once, so the focus
// after a navigation has a title to land on, and the content keeps its place when it arrives.
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <BackLink />
        <PageHeader title={t.title} />
      </div>
      {children}
    </div>
  )
}

// /exams/:examId: the exam's header, its days until the exam, its topics and tasks (all editable
// in place), then its materials and analysis, which fold.
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

  if (exams.isPending) {
    return (
      <Frame>
        <LoadingState shape="card" />
        <LoadingState shape="list" />
      </Frame>
    )
  }
  if (exams.isError) {
    return (
      <Frame>
        <ErrorState
          message={errorMessage(exams.error)}
          onRetry={() => {
            void exams.refetch()
          }}
        />
      </Frame>
    )
  }
  if (exam === undefined) {
    return (
      <Frame>
        <EmptyState title={t.notFound} description={t.notFoundHint} />
      </Frame>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
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
      {/* The two folding sections sit together: each draws its own line above, and this closes the last. */}
      <div className="border-b border-line">
        <MaterialsSection examId={exam.id} />
        <AnalysisSection examId={exam.id} />
      </div>
    </div>
  )
}
