import { en } from '../i18n/en'
import { DatePicker } from '../ui/DatePicker'
import { RadioCards } from '../ui/RadioCards'
import { TextField } from '../ui/TextField'
import { DIFFICULTY_OPTIONS, NAME_MAX, dateError, isoOf, type ExamDraft, type ExamFieldErrors } from './examForm'

const f = en.onboardingExams

// The three fields of an exam, shared by "new exam" and the header's in-place edit.
export function ExamFields({
  draft,
  errors,
  today,
  onChange,
  onErrors,
}: {
  draft: ExamDraft
  errors: ExamFieldErrors
  today: string
  onChange: (draft: ExamDraft) => void
  onErrors: (errors: ExamFieldErrors) => void
}) {
  return (
    <>
      <TextField
        label={f.name}
        placeholder={f.namePlaceholder}
        value={draft.name}
        onChange={(name) => {
          onChange({ ...draft, name })
          if (errors.name !== undefined) onErrors({ ...errors, name: undefined })
        }}
        maxLength={NAME_MAX}
        isRequired
        autoComplete="off"
        {...(errors.name === undefined ? {} : { errorMessage: errors.name })}
      />
      <DatePicker
        label={f.date}
        value={draft.date}
        onChange={(date) => {
          onChange({ ...draft, date })
          const iso = isoOf(date)
          onErrors({ ...errors, date: iso === null ? undefined : dateError(iso, today) })
        }}
        isDateUnavailable={(value) => dateError(value.toString().slice(0, 10), today) !== undefined}
        isRequired
        {...(errors.date === undefined ? {} : { errorMessage: errors.date })}
      />
      <RadioCards
        label={f.difficulty}
        options={DIFFICULTY_OPTIONS}
        value={draft.difficulty}
        onChange={(difficulty) => {
          onChange({ ...draft, difficulty })
        }}
        columns="grid-cols-5"
      />
    </>
  )
}
