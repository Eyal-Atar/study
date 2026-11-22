import { Pencil } from '../ui/icons'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import { errorMessage } from '../api/client'
import { en } from '../i18n/en'
import type { Exam } from '../onboarding/types'
import { useReplanOffer } from '../plan/replanOfferContext'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ExamInitial } from '../ui/ExamMark'
import { IconButton } from '../ui/IconButton'
import { PageHeader } from '../ui/PageHeader'
import { ICON_STROKE } from '../ui/styles'
import { useToast } from '../ui/useToast'
import { useUpdateExam, type ExamPatchVars } from './api'
import { daysBetween, longDate } from './dates'
import { ExamFields } from './ExamFields'
import { draftOf, validateDraft, type ExamDraft, type ExamFieldErrors } from './examForm'

const t = en.exam
const f = en.onboardingExams

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
    <Card title={t.header.editLabel} className="md:max-w-xl">
      <Form
        aria-label={t.header.editLabel}
        validationBehavior="aria"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className="flex flex-col gap-4"
      >
        <ExamFields draft={draft} errors={errors} today={today} onChange={setDraft} onErrors={setErrors} />
        {updateExam.isError ? (
          <p role="alert" className="text-small text-danger">
            {errorMessage(updateExam.error)}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1 sm:flex-none" isPending={updateExam.isPending}>
            {en.common.save}
          </Button>
          <Button variant="secondary" onPress={onDone}>
            {en.common.cancel}
          </Button>
        </div>
      </Form>
    </Card>
  )
}

// The exam's name, and under it one quiet line: date, days left, difficulty. "Edit" opens a small
// form under the title; the title itself stays, so the screen never loses its h1.
export function ExamHeader({ exam, today }: { exam: Exam; today: string }) {
  const [editing, setEditing] = useState(false)
  const difficulty = f.difficultyLevels[exam.difficulty - 1] ?? String(exam.difficulty)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <ExamInitial name={exam.name} colorIndex={exam.color_index} size="lg" />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={exam.name}
            userTitle
            subtitle={
              <>
                {t.header.dateThen(longDate(exam.exam_date))}
                <span className="font-semibold text-ink">{t.inDays(daysBetween(today, exam.exam_date))}</span>
                {t.header.thenDifficulty(f.difficultyOf(difficulty))}
              </>
            }
          />
        </div>
        {editing ? null : (
          <IconButton
            variant="secondary"
            aria-label={t.header.editLabel}
            onPress={() => {
              setEditing(true)
            }}
          >
            <Pencil aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
          </IconButton>
        )}
      </div>
      {editing ? (
        <EditForm
          exam={exam}
          today={today}
          onDone={() => {
            setEditing(false)
          }}
        />
      ) : null}
    </div>
  )
}
