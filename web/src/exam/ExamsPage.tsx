import { useId, useState } from 'react'
import { Form } from 'react-aria-components'
import { Link, useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import { useCreateExam, useExams } from '../onboarding/api'
import { Button } from '../ui/Button'
import { useToday } from './api'
import { daysBetween, longDate } from './dates'
import { ExamFields } from './ExamFields'
import { validateDraft, type ExamDraft, type ExamFieldErrors } from './examForm'

const t = he.exam

const EMPTY_DRAFT: ExamDraft = { name: '', date: null, difficulty: '3' }

// A short badge with the days left: brand-tinted while it is close, quiet otherwise.
function Countdown({ days }: { days: number }) {
  const near = days >= 0 && days <= 7
  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium tabular-nums ${
        near ? 'bg-brand-soft text-brand-strong' : 'bg-surface-muted text-ink-muted'
      }`}
    >
      {t.inDays(days)}
    </span>
  )
}

function NewExamForm({ today, onCancel }: { today: string; onCancel: () => void }) {
  const navigate = useNavigate()
  const createExam = useCreateExam()
  const titleId = useId()
  const [draft, setDraft] = useState<ExamDraft>(EMPTY_DRAFT)
  const [errors, setErrors] = useState<ExamFieldErrors>({})

  function submit() {
    const { errors: next, value } = validateDraft(draft, today)
    setErrors(next)
    if (value === null) return
    createExam.mutate(value, {
      onSuccess: (answer) => {
        void navigate(`/exams/${answer.exam.id}`)
      },
    })
  }

  return (
    <Form
      aria-labelledby={titleId}
      validationBehavior="aria"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-4"
    >
      <h2 id={titleId} className="text-lg font-medium text-ink">
        {t.list.formTitle}
      </h2>
      <ExamFields draft={draft} errors={errors} today={today} onChange={setDraft} onErrors={setErrors} />
      {createExam.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(createExam.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" isDisabled={createExam.isPending}>
          {createExam.isPending ? t.list.creating : t.list.create}
        </Button>
        <Button variant="secondary" onPress={onCancel}>
          {he.common.cancel}
        </Button>
      </div>
    </Form>
  )
}

// /exams: every live exam, closest first, each opening its own screen; and "new exam".
export function ExamsPage() {
  const exams = useExams()
  const { today } = useToday()
  const listTitleId = useId()
  const [adding, setAdding] = useState(false)

  const sorted = [...(exams.data ?? [])].sort((a, b) => a.exam_date.localeCompare(b.exam_date))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-ink">{t.list.title}</h1>
        {adding ? null : (
          <Button
            variant="secondary"
            onPress={() => {
              setAdding(true)
            }}
          >
            {t.list.newExam}
          </Button>
        )}
      </div>

      {adding ? (
        <NewExamForm
          today={today}
          onCancel={() => {
            setAdding(false)
          }}
        />
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby={listTitleId}>
        <h2 id={listTitleId} className="sr-only">
          {t.list.listTitle}
        </h2>
        {exams.isPending ? (
          <p className="text-ink-muted">{he.common.loading}</p>
        ) : exams.isError ? (
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
        ) : sorted.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-center text-ink-muted">
            {t.list.empty}
          </p>
        ) : (
          <ul aria-labelledby={listTitleId} className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {sorted.map((exam) => (
              <li key={exam.id}>
                <Link
                  to={`/exams/${exam.id}`}
                  className="flex min-h-16 items-center gap-3 px-4 py-3 outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-ink">{exam.name}</span>
                    <span className="text-sm text-ink-muted">{longDate(exam.exam_date)}</span>
                  </span>
                  <Countdown days={daysBetween(today, exam.exam_date)} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
