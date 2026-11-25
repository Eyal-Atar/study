import { ChevronLeft } from '../ui/icons'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { errorMessage } from '../api/client'
import { useMe } from '../api/me'
import { en } from '../i18n/en'
import { useExams } from '../onboarding/api'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/states'
import { ICON_STROKE } from '../ui/styles'
import { ButtonLink } from '../ui/ButtonLink'
import { AnalysisSection } from './AnalysisSection'
import { useExamPlan, useExamTasks, useToday } from './api'
import { examProgress } from './examProgress'
import { examState } from '../closure/types'
import { ClosureCard, ClosureSheets, type ClosureSheetState } from './ClosureCard'
import { ExamHeader } from './ExamHeader'
import { MaterialsSection } from './MaterialsSection'
import { PracticeExamButton } from './PracticeExamButton'
import { TaskList } from './TaskList'
import { Timeline } from './Timeline'
import { timelineRange } from './timelineDays'

const t = en.exam

// In LTR "back" points left.
function BackLink() {
  return (
    // The negative margin lines the arrow up with the edge of the page, as the quiet button of the prototype does.
    <ButtonLink to="/exams" variant="quiet" className="gap-1 self-start -ms-2.5">
      <ChevronLeft aria-hidden="true" size={17} strokeWidth={ICON_STROKE} />
      {t.backToList}
    </ButtonLink>
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
  // A closed exam has no plan to show, and the server answers nothing for it.
  const live = exam !== undefined && examState(exam) === 'active'
  const plan = useExamPlan(examId, live ? range.query : null)
  // The closure sheets live here and not in the card: Moed B turns the exam active, and the card goes.
  const [sheet, setSheet] = useState<ClosureSheetState>(null)
  // The same query as the task list: one request, and the same minutes (S34 decision 11).
  const tasks = useExamTasks(examId)
  const navigate = useNavigate()
  // "Delete it" was pressed on this screen (its card or its sheet). A refresh can take the card off the screen after
  // the server committed and before the answer (GET /closures every 5 minutes, GET /exams on focus),
  // and a 404 has no onSuccess (in the sheet it closes the sheet before the exams refetch): either way
  // neither can leave the screen itself, so the page does
  // once the exam is gone. The toast with its Undo is the action's, and stays.
  const deletedHere = useRef(false)
  const gone = exams.data !== undefined && exam === undefined
  useEffect(() => {
    // focusTitle: the pressed button is gone, so the h1 of the list takes the focus.
    if (gone && sheet === null && deletedHere.current) void navigate('/exams', { replace: true, state: { focusTitle: true } })
  }, [gone, sheet, navigate])

  if (exams.isPending) {
    return (
      <Frame>
        <LoadingState shape="card" />
        <LoadingState shape="list" />
      </Frame>
    )
  }
  // Only when there is nothing to show: a background refresh that fails keeps the screen, and with it
  // the sheets (the state after Moed B and its Undo).
  if (exams.isError && exams.data === undefined) {
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
  // The sheets sit outside every branch, at the same place in the tree (the second child of the
  // fragment): an exam deleted from the sheet leaves GET /exams while the sheet still shows its "after"
  // state and its Undo, and an Undo brings the exam back under the same sheet. React keeps it mounted
  // through both.
  const sheets = (
    <ClosureSheets
      sheet={sheet}
      onDelete={() => {
        deletedHere.current = true
      }}
      onClose={() => {
        setSheet(null)
        // Deleted while the sheet was open: its screen is gone too, and Back does not return to it.
        if (exam === undefined) void navigate('/exams', { replace: true, state: { focusTitle: true } })
      }}
    />
  )
  if (exam === undefined) {
    return (
      <>
        <Frame>
          <EmptyState title={t.notFound} description={t.notFoundHint} />
        </Frame>
        {sheets}
      </>
    )
  }

  const state = examState(exam)
  // Pending, waiting for a retake or closed: the header and the card of Archi, nothing the server
  // refuses. A pending exam keeps its edit button (a wrong date put right brings it back to active).
  // One tree for every state, so the sheets stay mounted when the state changes under them.
  const content = (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <BackLink />
        <ExamHeader exam={exam} today={today} canEdit={state === 'active' || state === 'pending'} />
      </div>
      {state === 'active' ? (
        <>
          <Timeline
            examId={exam.id}
            colorIndex={exam.color_index}
            percent={tasks.isSuccess ? examProgress(tasks.data).percent : undefined}
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
          <TaskList examId={exam.id} colorIndex={exam.color_index} blocks={plan.data?.blocks ?? []} timeZone={timeZone} />
          {/* The two folding sections sit together: each draws its own line above, and this closes the last. */}
          <div className="border-b border-line">
            <MaterialsSection examId={exam.id} />
            <AnalysisSection examId={exam.id} />
          </div>
          <PracticeExamButton />
        </>
      ) : (
        <ClosureCard
          exam={exam}
          state={state}
          onOpen={setSheet}
          onDelete={() => {
            deletedHere.current = true
          }}
        />
      )}
    </div>
  )
  return (
    <>
      {content}
      {sheets}
    </>
  )
}
