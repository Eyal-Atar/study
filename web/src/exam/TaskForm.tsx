import { useState } from 'react'
import { Form } from 'react-aria-components'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { TextField } from '../ui/TextField'
import { SelectField } from './SelectField'
import { emptyErrors, validateTask, type TaskDraft, type TaskDraftErrors, type TaskValues } from './taskDraft'
import { TASK_KINDS, type Topic } from './types'

const t = he.exam.tasks

const KIND_OPTIONS = TASK_KINDS.map((kind) => ({ value: kind, label: t.kinds[kind] }))

// The fields of a task, for the in-place edit (with focus) and for "add task" (without).
// Nothing is sent until "שמירה" or Enter; the caller decides what to send.
export function TaskForm({
  label,
  initial,
  topics,
  withFocus,
  submitLabel,
  isPending,
  onSubmit,
  onCancel,
}: {
  label: string
  initial: TaskDraft
  topics: readonly Topic[]
  withFocus: boolean
  submitLabel: string
  isPending: boolean
  onSubmit: (values: TaskValues) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<TaskDraft>(initial)
  const [errors, setErrors] = useState<TaskDraftErrors>(emptyErrors)
  const topicOptions = [{ value: '', label: he.exam.topics.noTopic }, ...topics.map((p) => ({ value: p.id, label: p.name }))]

  function set<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  return (
    <Form
      aria-label={label}
      validationBehavior="aria"
      onSubmit={(event) => {
        event.preventDefault()
        const { errors: next, values } = validateTask(draft, withFocus)
        setErrors(next)
        if (values !== null) onSubmit(values)
      }}
      className="flex flex-col gap-4"
    >
      <TextField
        label={t.title}
        value={draft.title}
        onChange={(value) => {
          set('title', value)
        }}
        maxLength={200}
        isRequired
        autoComplete="off"
        {...(errors.title === undefined ? {} : { errorMessage: errors.title })}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label={t.minutesLabel}
          value={draft.minutes}
          inputMode="numeric"
          onChange={(value) => {
            set('minutes', value)
          }}
          {...(errors.minutes === undefined ? {} : { errorMessage: errors.minutes })}
        />
        {withFocus ? (
          <TextField
            label={t.focusLabel}
            value={draft.focus}
            inputMode="numeric"
            onChange={(value) => {
              set('focus', value)
            }}
            {...(errors.focus === undefined ? {} : { errorMessage: errors.focus })}
          />
        ) : null}
      </div>
      <SelectField
        label={t.kind}
        value={draft.kind}
        options={KIND_OPTIONS}
        onChange={(value) => {
          set('kind', value as TaskDraft['kind'])
        }}
      />
      <SelectField
        label={t.topic}
        value={draft.topicId}
        options={topicOptions}
        onChange={(value) => {
          set('topicId', value)
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" isDisabled={isPending}>
          {submitLabel}
        </Button>
        <Button variant="secondary" onPress={onCancel}>
          {he.common.cancel}
        </Button>
      </div>
    </Form>
  )
}
