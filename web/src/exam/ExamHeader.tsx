import { useState } from 'react'
import { Form } from 'react-aria-components'
import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import type { Exam } from '../onboarding/types'
import { useReplanOffer } from '../plan/replanOfferContext'
import { Button } from '../ui/Button'
import { useToast } from '../ui/useToast'
import { useUpdateExam, type ExamPatchVars } from './api'
import { daysBetween, longDate } from './dates'
import { ExamFields } from './ExamFields'
import { draftOf, validateDraft, type ExamDraft, type ExamFieldErrors } from './examForm'

const t = he.exam
const f = he.onboardingExams

function EditForm({ exam, today, onDone }: { exam: Exam; today: string; onDone: () => void }) {
  const updateExam = useUpdateExam()
  const toast = useToast()
  const { offer } = useReplanOffer()
  const [draft, setDraft] = useState<ExamDraft>(() => draftOf(exam))
  const [errors, setErrors] = useState<ExamFieldErrors>({})

  function submit() {
    // An unchanged date may already be "today" (an old exam): only a changed date is checked.
    const { errors: next, value } = validateDraft(draft, today)
    const dateUnchanged = draft.date?.toString().slice(0, 10) === exam.exam_date
    if (dateUnchanged) next.date = undefined
    setErrors(next)
    const name = draft.name.trim()
    if (next.name !== undefined || next.date !== undefined) return
    const body: ExamPatchVars['body'] = {}
    if (name !== exam.name) body.name = name
    if (value !== null && value.exam_date !== exam.exam_date) body.exam_date = value.exam_date
    if (Number(draft.difficulty) !== exam.difficulty) body.difficulty = Number(draft.difficulty)
    if (Object.keys(body).length === 0) {
      onDone()
      return
    }
    updateExam.mutate(
      { examId: exam.id, body },
      {
        onSuccess: (answer) => {
          onDone()
          if (answer.plan_affected) offer(t.header.replanReason)
          else toast.show({ text: t.header.saved, tone: 'success' })
        },
      },
    )
  }

  return (
    <Form
      aria-label={t.header.editLabel}
      validationBehavior="aria"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-4"
    >
      <ExamFields draft={draft} errors={errors} today={today} onChange={setDraft} onErrors={setErrors} />
      {updateExam.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(updateExam.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" isDisabled={updateExam.isPending}>
          {updateExam.isPending ? t.header.saving : he.common.save}
        </Button>
        <Button variant="secondary" onPress={onDone}>
          {he.common.cancel}
        </Button>
      </div>
    </Form>
  )
}

// The exam's name, date, days left and difficulty; "עריכה" turns it into a small form in place.
export function ExamHeader({ exam, today }: { exam: Exam; today: string }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <EditForm
        exam={exam}
        today={today}
        onDone={() => {
          setEditing(false)
        }}
      />
    )
  }
  const difficulty = f.difficultyLevels[exam.difficulty - 1] ?? String(exam.difficulty)
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="break-words text-2xl font-bold text-ink">{exam.name}</h1>
        <p className="text-ink-muted">
          {longDate(exam.exam_date)}
          <span className="mx-2 font-medium text-brand-strong">{t.inDays(daysBetween(today, exam.exam_date))}</span>
        </p>
        <p className="text-sm text-ink-muted">{f.difficultyOf(difficulty)}</p>
      </div>
      <Button
        variant="secondary"
        onPress={() => {
          setEditing(true)
        }}
      >
        {t.header.editLabel}
      </Button>
    </header>
  )
}
