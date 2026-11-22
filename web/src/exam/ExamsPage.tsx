import { Plus } from '../ui/icons'
import { useQueries } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Form } from 'react-aria-components'
import { useNavigate } from 'react-router'
import { useApi } from '../api/ApiContext'
import { errorMessage } from '../api/client'
import { useUserId } from '../api/me'
import { en } from '../i18n/en'
import { useCreateExam, useExams } from '../onboarding/api'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { List, ListRow } from '../ui/List'
import { PageHeader } from '../ui/PageHeader'
import { ErrorState, LoadingState } from '../ui/states'
import { ICON_STROKE } from '../ui/styles'
import { ExamChip, ExamInitial, ExamProgressBar } from '../ui/ExamMark'
import { UserText } from '../ui/UserText'
import { Archie } from '../archie/Archie'
import type { Exam } from '../onboarding/types'
import { examProgress } from './examProgress'
import type { ExamTask } from './types'
import { tasksKey, useToday } from './api'
import { daysBetween, longDate } from './dates'
import { ExamFields } from './ExamFields'
import { validateDraft, type ExamDraft, type ExamFieldErrors } from './examForm'

const t = en.exam

const EMPTY_DRAFT: ExamDraft = { name: '', date: null, difficulty: '3' }

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
    <Card title={t.list.formTitle} className="md:max-w-xl">
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
            {en.common.cancel}
          </Button>
        </div>
      </Form>
    </Card>
  )
}

// One row of the card: the initial, the name, the chip of the days left, the date with the
// progress, and the thin bar. `tasks` is undefined while they load or when they failed to load:
// the row shows the date alone then, and an empty bar.
function ExamRow({ exam, today, tasks }: { exam: Exam; today: string; tasks: ExamTask[] | undefined }) {
  const x = en.exams.list
  const progress = tasks === undefined ? null : examProgress(tasks)
  const detail = progress === null ? null : progress.total === 0 ? x.noTasks : x.progress(progress.percent)
  const date = longDate(exam.exam_date)
  return (
    <ListRow
      to={`/exams/${exam.id}`}
      leading={<ExamInitial name={exam.name} colorIndex={exam.color_index} />}
      title={<UserText>{exam.name}</UserText>}
      subtitle={
        <>
          <span>{detail === null ? date : x.rowDetail(date, detail)}</span>
          {progress === null ? (
            <div className="h-[5px]" />
          ) : (
            <ExamProgressBar
              colorIndex={exam.color_index}
              value={progress.done}
              max={progress.total}
              aria-label={x.progressLabel(exam.name)}
              valueText={detail}
            />
          )}
        </>
      }
      trailing={<ExamChip colorIndex={exam.color_index}>{x.chip(daysBetween(today, exam.exam_date))}</ExamChip>}
    />
  )
}

// What a student with no exam sees: Archi, the one h1 in his words, one line, and the button.
function EmptyExams({ onAdd }: { onAdd: (() => void) | null }) {
  // The tab is named like the list's PageHeader names it, and the plain name comes back on leaving.
  useEffect(() => {
    document.title = `${t.list.title} – ${en.appName}`
    return () => {
      document.title = en.appName
    }
  }, [])
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="w-full border-b border-line">
        <Archie mood="intentions" size="scene" eager />
      </div>
      <h1 tabIndex={-1} className="outline-none font-display text-[2.125rem] leading-none font-bold text-balance text-ink">
        {t.list.empty}
      </h1>
      <p className="text-body text-ink-muted">{t.list.emptyHint}</p>
      {onAdd === null ? null : <Button onPress={onAdd}>{t.list.create}</Button>}
    </div>
  )
}

// /exams: every live exam on one card, closest first, each opening its own screen; and "new exam".
export function ExamsPage() {
  const exams = useExams()
  const { today } = useToday()
  const [adding, setAdding] = useState(false)

  const sorted = [...(exams.data ?? [])].sort((a, b) => a.exam_date.localeCompare(b.exam_date))
  const isEmpty = exams.isSuccess && sorted.length === 0
  const api = useApi()
  const userId = useUserId()
  const taskQueries = useQueries({
    queries: sorted.map((exam) => ({
      queryKey: tasksKey(userId, exam.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<ExamTask[]>(`/exams/${exam.id}/tasks`, { signal }),
      enabled: userId !== null,
    })),
  })
  const open = () => {
    setAdding(true)
  }

  const form = adding ? (
    <NewExamForm
      today={today}
      onCancel={() => {
        setAdding(false)
      }}
    />
  ) : null

  if (isEmpty) {
    return (
      <div className="flex flex-col gap-6">
        {form}
        <EmptyExams onAdd={adding ? null : open} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.list.title}
        {...(sorted.length === 0
          ? {}
          : {
              subtitle: <span className="tabular-nums">{t.list.count(sorted.length)}</span>,
            })}
        // One blue button on the screen: while the form is open it is the form's own.
        action={
          adding ? null : (
            <Button onPress={open}>
              <Plus aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
              {t.list.newExam}
            </Button>
          )
        }
      />

      {form}

      {exams.isPending ? (
        <LoadingState shape="card" />
      ) : exams.isError ? (
        <ErrorState
          message={errorMessage(exams.error)}
          onRetry={() => {
            void exams.refetch()
          }}
        />
      ) : (
        <Card>
          <List aria-label={t.list.listTitle}>
            {sorted.map((exam, index) => (
              <ExamRow key={exam.id} exam={exam} today={today} tasks={taskQueries[index]?.data} />
            ))}
          </List>
        </Card>
      )}
    </div>
  )
}
