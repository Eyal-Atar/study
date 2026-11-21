import { Trash2 } from '../ui/icons'
import { useId, useState } from 'react'
import { Form } from 'react-aria-components'
import { useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { DatePicker, type DateValue } from '../ui/DatePicker'
import { IconButton } from '../ui/IconButton'
import { List, ListRow } from '../ui/List'
import { RadioCards } from '../ui/RadioCards'
import { SectionHeading } from '../ui/SectionHeading'
import { EmptyState, ErrorState, LoadingState } from '../ui/states'
import { ICON_STROKE } from '../ui/styles'
import { TextField } from '../ui/TextField'
import { useToast } from '../ui/useToast'
import { useCreateExam, useDeleteExam, useExams, useUndo, type Exam } from './api'
import { OnboardingLayout } from './OnboardingLayout'
import { STEP_PATHS } from './steps'

const t = en.onboardingExams

// The API's limits (ExamCreate in api/app/schemas): a name of up to 200 characters, a date from
// tomorrow up to two years ahead, difficulty 1–5.
const NAME_MAX = 200
const MAX_DAYS_AHEAD = 730
const DEFAULT_DIFFICULTY = '3'

const DIFFICULTY_OPTIONS = t.difficultyLevels.map((label, index) => ({ value: String(index + 1), label }))

// A local date `days` from today as 'YYYY-MM-DD'. Strings in this form compare in date order.
function localIso(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dateRangeError(iso: string): string | undefined {
  if (iso < localIso(1)) return t.dateTooEarly
  if (iso > localIso(MAX_DAYS_AHEAD)) return t.dateTooLate
  return undefined
}

// '2027-01-20' → '20 בינואר 2027', read as a local date (new Date('2027-01-20') would be UTC midnight).
const DATE_FORMAT = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
function hebrewDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return iso
  return DATE_FORMAT.format(new Date(year, month - 1, day))
}

function difficultyLabel(difficulty: number): string {
  return t.difficultyLevels[difficulty - 1] ?? String(difficulty)
}

interface FieldErrors {
  name?: string
  date?: string
}

// Onboarding step 1: the student's exams. Each one is saved on the server as it is added, so the
// step keeps no local state that a refresh would lose.
export function ExamsStep() {
  const navigate = useNavigate()
  const toast = useToast()
  const exams = useExams()
  const createExam = useCreateExam()
  const deleteExam = useDeleteExam()
  const undo = useUndo()
  const listTitleId = useId()

  const [name, setName] = useState('')
  const [date, setDate] = useState<DateValue | null>(null)
  const [difficulty, setDifficulty] = useState(DEFAULT_DIFFICULTY)
  const [errors, setErrors] = useState<FieldErrors>({})
  // Exams whose DELETE is on its way: hidden at once, and back if it fails.
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(() => new Set())

  const visible = (exams.data ?? [])
    .filter((exam) => !deleting.has(exam.id))
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date))

  function submit() {
    const trimmed = name.trim()
    const iso = date === null ? null : date.toString().slice(0, 10)
    const next: FieldErrors = {}
    if (trimmed === '') next.name = t.nameRequired
    else if (trimmed.length > NAME_MAX) next.name = t.nameTooLong
    if (iso === null) next.date = t.dateRequired
    else {
      const rangeError = dateRangeError(iso)
      if (rangeError !== undefined) next.date = rangeError
    }
    setErrors(next)
    if (next.name !== undefined || next.date !== undefined || iso === null) return

    createExam.mutate(
      { name: trimmed, exam_date: iso, difficulty: Number(difficulty) },
      {
        onSuccess: () => {
          setName('')
          setDate(null)
          setDifficulty(DEFAULT_DIFFICULTY)
        },
      },
    )
  }

  function setDeletingFlag(id: string, on: boolean) {
    setDeleting((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // mutateAsync, not mutate with callbacks: a second delete before the first answers would drop the
  // first one's callbacks, and with them its toast.
  function remove(exam: Exam) {
    setDeletingFlag(exam.id, true)
    deleteExam
      .mutateAsync(exam.id)
      .then((answer) => {
        const versionId = answer.version_id
        toast.show({
          text: t.deleted(exam.name),
          ...(versionId === null
            ? {}
            : {
                action: {
                  label: en.common.undo,
                  onAction: () => {
                    undo.mutateAsync(versionId).then(
                      () => toast.show({ text: t.restored(exam.name), tone: 'success' }),
                      (error: unknown) => toast.show({ text: errorMessage(error), tone: 'error' }),
                    )
                  },
                },
              }),
        })
      })
      .catch((error: unknown) => {
        toast.show({ text: errorMessage(error), tone: 'error' })
      })
      .finally(() => {
        setDeletingFlag(exam.id, false)
      })
  }

  // One blue thing at a time, and it is the next step: adding an exam while there is none (the
  // continue button is disabled then), and going on once there is one.
  const hasExams = visible.length > 0

  const actions = (
    <Button
      className="flex-1 md:flex-none"
      isDisabled={!hasExams}
      onPress={() => {
        void navigate(STEP_PATHS.materials)
      }}
    >
      {en.onboarding.continue}
    </Button>
  )

  return (
    <OnboardingLayout step={1} title={t.title} intro={t.intro} actions={actions}>
      <Card className="md:max-w-xl">
        <Form
          validationBehavior="aria"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="flex flex-col gap-5"
        >
          <TextField
            label={t.name}
            placeholder={t.namePlaceholder}
            value={name}
            onChange={(value) => {
              setName(value)
              if (errors.name !== undefined) setErrors((e) => ({ ...e, name: undefined }))
            }}
            maxLength={NAME_MAX}
            isRequired
            autoComplete="off"
            {...(errors.name === undefined ? {} : { errorMessage: errors.name })}
          />
          <DatePicker
            label={t.date}
            value={date}
            onChange={(value) => {
              setDate(value)
              // A full date out of range is flagged at once; a missing one only when adding.
              setErrors((e) => ({ ...e, date: value === null ? undefined : dateRangeError(value.toString().slice(0, 10)) }))
            }}
            isDateUnavailable={(value) => dateRangeError(value.toString().slice(0, 10)) !== undefined}
            isRequired
            {...(errors.date === undefined ? {} : { errorMessage: errors.date })}
          />
          <RadioCards
            label={t.difficulty}
            options={DIFFICULTY_OPTIONS}
            value={difficulty}
            onChange={setDifficulty}
            columns="grid-cols-5"
          />
          {createExam.isError ? (
            <p role="alert" className="text-small text-danger">
              {errorMessage(createExam.error)}
            </p>
          ) : null}
          {/* isPending keeps the text and ignores presses, so a double press sends one exam. */}
          <Button type="submit" variant={hasExams ? 'secondary' : 'primary'} isPending={createExam.isPending}>
            {t.add}
          </Button>
        </Form>
      </Card>

      <section className="flex flex-col gap-1" aria-labelledby={listTitleId}>
        <SectionHeading id={listTitleId}>{t.listTitle}</SectionHeading>
        {exams.isPending ? (
          <LoadingState shape="list" rows={2} />
        ) : exams.isError ? (
          <div className="pt-2">
            <ErrorState
              message={errorMessage(exams.error)}
              onRetry={() => {
                void exams.refetch()
              }}
            />
          </div>
        ) : !hasExams ? (
          <EmptyState title={t.empty} />
        ) : (
          <List aria-label={t.listTitle}>
            {visible.map((exam) => (
              <ListRow
                key={exam.id}
                // An exam name can be in any language: <bdi> isolates its direction.
                title={<bdi>{exam.name}</bdi>}
                subtitle={
                  <span className="tabular-nums">{t.details(hebrewDate(exam.exam_date), difficultyLabel(exam.difficulty))}</span>
                }
                trailing={
                  <IconButton
                    aria-label={t.deleteExam(exam.name)}
                    onPress={() => {
                      remove(exam)
                    }}
                  >
                    <Trash2 aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
                  </IconButton>
                }
              />
            ))}
          </List>
        )}
      </section>
    </OnboardingLayout>
  )
}
