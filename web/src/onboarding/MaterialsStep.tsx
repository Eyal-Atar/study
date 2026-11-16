import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { useExams } from './api'
import { ExamMaterials } from './ExamMaterials'
import { OnboardingLayout } from './OnboardingLayout'
import { flushDeletes } from './pendingDeletes'
import { STEP_PATHS } from './steps'

const t = he.onboardingMaterials

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
      title={t.title}
      intro={t.intro}
      actions={
        <>
          <Button variant="secondary" isDisabled={leaving} onPress={() => { leave(STEP_PATHS.exams); }}>
            {he.common.back}
          </Button>
          {hasFiles ? (
            <Button isDisabled={leaving} onPress={() => { leave(STEP_PATHS.schedule); }}>
              {he.common.next}
            </Button>
          ) : (
            <Button variant="quiet" isDisabled={leaving} onPress={() => { leave(STEP_PATHS.schedule); }}>
              {he.common.skip}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-1 text-sm text-ink-muted">
        <p>{t.privacy}</p>
        <p>{t.fileTypes}</p>
      </div>

      <div>
        {exams.isPending ? (
          <p className="text-sm text-ink-muted">{he.common.loading}</p>
        ) : exams.isError ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-danger">
              {errorMessage(exams.error)}
            </p>
            <Button variant="quiet" onPress={() => void exams.refetch()}>
              {he.common.retry}
            </Button>
          </div>
        ) : exams.data.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.noExams}</p>
        ) : (
          exams.data.map((exam) => <ExamMaterials key={exam.id} exam={exam} onCountChange={onCountChange} />)
        )}
      </div>
    </OnboardingLayout>
  )
}
