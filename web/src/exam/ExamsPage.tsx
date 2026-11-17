import { FileText, Plus } from 'lucide-react'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import { useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import { useCreateExam, useExams } from '../onboarding/api'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { List, ListRow } from '../ui/List'
import { PageHeader } from '../ui/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '../ui/states'
import { ICON_STROKE } from '../ui/styles'
import { useToday } from './api'
import { daysBetween, longDate } from './dates'
import { ExamFields } from './ExamFields'
import { validateDraft, type ExamDraft, type ExamFieldErrors } from './examForm'

const t = he.exam

const EMPTY_DRAFT: ExamDraft = { name: '', date: null, difficulty: '3' }

// The days left: brand-tinted while the exam is within a week, quiet otherwise (and when it passed).
function Countdown({ days }: { days: number }) {
  const near = days >= 0 && days <= 7
  return <Badge tone={near ? 'brand' : 'neutral'}>{t.inDays(days)}</Badge>
}

function NewExamForm({ today, onCancel }: { today: string; onCancel: () => void }) {
  const navigate = useNavigate()
  const createExam = useCreateExam()
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
    <Card title={t.list.formTitle}>
      <Form
        aria-label={t.list.formTitle}
        validationBehavior="aria"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className="flex flex-col gap-4"
      >
        <ExamFields draft={draft} errors={errors} today={today} onChange={setDraft} onErrors={setErrors} />
        {createExam.isError ? (
          <p role="alert" className="text-small text-danger">
            {errorMessage(createExam.error)}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1 sm:flex-none" isPending={createExam.isPending}>
            {t.list.create}
          </Button>
          <Button variant="secondary" onPress={onCancel}>
            {he.common.cancel}
          </Button>
        </div>
      </Form>
    </Card>
  )
}

// /exams: every live exam, closest first, each opening its own screen; and "new exam".
export function ExamsPage() {
  const exams = useExams()
  const { today } = useToday()
  const [adding, setAdding] = useState(false)

  const sorted = [...(exams.data ?? [])].sort((a, b) => a.exam_date.localeCompare(b.exam_date))
  const isEmpty = exams.isSuccess && sorted.length === 0
  const open = () => {
    setAdding(true)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.list.title}
        {...(sorted.length === 0 ? {} : { subtitle: <span className="tabular-nums">{t.list.count(sorted.length)}</span> })}
        // One blue button on the screen: with no exams it is the one inside the empty state, and
        // while the form is open it is the form's own.
        action={
          adding || isEmpty ? null : (
            <Button onPress={open}>
              <Plus aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
              {t.list.newExam}
            </Button>
          )
        }
      />

      {adding ? (
        <NewExamForm
          today={today}
          onCancel={() => {
            setAdding(false)
          }}
        />
      ) : null}

      {exams.isPending ? (
        <LoadingState shape="list" />
      ) : exams.isError ? (
        <ErrorState
          message={errorMessage(exams.error)}
          onRetry={() => {
            void exams.refetch()
          }}
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t.list.empty}
          description={t.list.emptyHint}
          action={adding ? undefined : <Button onPress={open}>{t.list.create}</Button>}
        />
      ) : (
        <List aria-label={t.list.listTitle} className="border-t border-line">
          {sorted.map((exam) => (
            <ListRow
              key={exam.id}
              to={`/exams/${exam.id}`}
              title={exam.name}
              subtitle={longDate(exam.exam_date)}
              trailing={<Countdown days={daysBetween(today, exam.exam_date)} />}
            />
          ))}
        </List>
      )}
    </div>
  )
}
