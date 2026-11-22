import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Lock } from '../ui/icons'
import { Note } from '../ui/Note'
import { ICON_STROKE } from '../ui/styles'
import { EmptyState, ErrorState, LoadingState } from '../ui/states'
import { useExams } from './api'
import { ExamMaterials } from './ExamMaterials'
import { OnboardingLayout } from './OnboardingLayout'
import { flushDeletes } from './pendingDeletes'
import { STEP_PATHS } from './steps'

const t = en.onboardingMaterials

// Step 2 of the onboarding (/onboarding/materials): files for each exam, all optional. The files live on the
// server, so leaving the step (or refreshing) loses only uploads still on their way.
export function MaterialsStep() {
  const exams = useExams()
  const navigate = useNavigate()
  // Files on screen per exam (registered, not hidden by a pending delete, plus uploads), reported by each section.
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({})
  const onCountChange = useCallback((examId: string, count: number) => {
    setCounts((current) => (current[examId] === count ? current : { ...current, [examId]: count }))
  }, [])
  const hasFiles = (exams.data ?? []).some((exam) => (counts[exam.id] ?? 0) > 0)
  // What I keep of step 1: the exams, as one quiet line.
  const recap =
    exams.data === undefined || exams.data.length === 0
      ? undefined
      : en.onboardingFlow.examsRecap(exams.data.map((exam) => exam.name))
  const [leaving, setLeaving] = useState(false)

  // A file deleted on screen is deleted on the server only when its undo toast expires. Leaving sends those
  // deletes now and waits for them, so the next steps never analyze a deleted file. One that fails puts its
  // file back with an error toast, and the user stays here to see it.
  function leave(path: string) {
    if (leaving) return
    setLeaving(true)
    void flushDeletes().then((done) => {
      if (done) void navigate(path)
      else setLeaving(false)
    })
  }

  // Any other way out (the browser's back button, a link) still sends the waiting deletes.
  useEffect(
    () => () => {
      void flushDeletes()
    },
    [],
  )

  return (
    <OnboardingLayout
      step={2}
      mood="wisdom"
      question={t.title}
      below={t.intro}
      recap={recap}
      bare
      // "Back" is at the top of the layout; it too sends the waiting deletes before it leaves.
      onBack={() => { leave(STEP_PATHS.exams); }}
      primary={
        // One way forward. Without files the same button says that it skips them, so nobody
        // has to look for a second button.
        <Button className="flex-1 md:flex-none" isDisabled={leaving} onPress={() => { leave(STEP_PATHS.schedule); }}>
          {hasFiles ? en.onboarding.continue : t.continueWithout}
        </Button>
      }
    >
      {exams.isPending ? (
        <LoadingState shape="list" rows={3} />
      ) : exams.isError ? (
        <ErrorState message={errorMessage(exams.error)} onRetry={() => void exams.refetch()} />
      ) : exams.data.length === 0 ? (
        <EmptyState title={t.noExams} description={t.noExamsHint} />
      ) : (
        <Card>
          <div className="flex flex-col gap-section">
            {exams.data.map((exam) => (
              <ExamMaterials key={exam.id} exam={exam} onCountChange={onCountChange} />
            ))}
          </div>
        </Card>
      )}

      {/* After the files, where the prototype has it: the card is what he asked for, this is what to
          know about it. The limits go with it. */}
      <Note>
        <p className="flex items-start gap-2">
          <Lock aria-hidden="true" size={16} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" />
          <span>{t.privacy}</span>
        </p>
        <p className="mt-1 ps-6">{t.fileTypes}</p>
      </Note>
    </OnboardingLayout>
  )
}
