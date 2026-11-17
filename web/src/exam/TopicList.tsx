import { useId, useState } from 'react'
import { Form } from 'react-aria-components'
import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { RadioCards } from '../ui/RadioCards'
import { TextField } from '../ui/TextField'
import { useToast } from '../ui/useToast'
import { useUpdateTopic } from './api'
import { Disclosure } from '../ui/Disclosure'
import type { Gap, Topic, TopicPatch } from './types'

const tp = he.exam.topics

const NAME_MAX = 120
const WEIGHT_OPTIONS = [1, 2, 3, 4, 5].map((w) => ({ value: String(w), label: String(w) }))

// 1–5 filled dots; the text next to it is what a screen reader hears.
function WeightDots({ weight }: { weight: number }) {
  return (
    <span className="flex items-center gap-1">
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`size-2 rounded-full ${n <= weight ? 'bg-brand' : 'bg-line-strong'}`} />
        ))}
      </span>
      <span className="sr-only">{tp.weight(weight)}</span>
    </span>
  )
}

function TopicForm({ topic, onDone }: { topic: Topic; onDone: () => void }) {
  const update = useUpdateTopic()
  const toast = useToast()
  const [name, setName] = useState(topic.name)
  const [weight, setWeight] = useState(String(topic.weight))
  const [nameError, setNameError] = useState<string | undefined>(undefined)

  function submit() {
    const trimmed = name.trim()
    if (trimmed === '' || trimmed.length > NAME_MAX) {
      setNameError(tp.nameRequired)
      return
    }
    const body: TopicPatch = {}
    if (trimmed !== topic.name) body.name = trimmed
    if (Number(weight) !== topic.weight) body.weight = Number(weight)
    if (Object.keys(body).length === 0) {
      onDone()
      return
    }
    update.mutate(
      { topicId: topic.id, examId: topic.exam_id, body },
      {
        onSuccess: () => {
          toast.show({ text: tp.saved, tone: 'success' })
          onDone()
        },
        onError: (error) => {
          toast.show({ text: errorMessage(error), tone: 'error' })
        },
      },
    )
  }

  return (
    <Form
      aria-label={tp.editNamed(topic.name)}
      validationBehavior="aria"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4"
    >
      <TextField
        label={tp.name}
        value={name}
        onChange={(value) => {
          setName(value)
          setNameError(undefined)
        }}
        maxLength={NAME_MAX}
        isRequired
        autoComplete="off"
        {...(nameError === undefined ? {} : { errorMessage: nameError })}
      />
      <RadioCards label={tp.weightLabel} options={WEIGHT_OPTIONS} value={weight} onChange={setWeight} columns="grid-cols-5" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" isDisabled={update.isPending}>
          {he.common.save}
        </Button>
        <Button variant="secondary" onPress={onDone}>
          {he.common.cancel}
        </Button>
      </div>
    </Form>
  )
}

// The head of a topic group: name, weight and evidence, with "עריכה" for name and weight.
export function TopicHeader({ topic, headingId }: { topic: Topic; headingId: string }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <TopicForm
        topic={topic}
        onDone={() => {
          setEditing(false)
        }}
      />
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <h3 id={headingId} className="min-w-0 flex-1 break-words text-base font-semibold text-ink">
          {topic.name}
        </h3>
        <WeightDots weight={topic.weight} />
        <Button
          variant="quiet"
          aria-label={tp.editNamed(topic.name)}
          onPress={() => {
            setEditing(true)
          }}
        >
          {tp.edit}
        </Button>
      </div>
      {topic.evidence === null || topic.evidence === '' ? null : <Disclosure label={tp.evidence}>{topic.evidence}</Disclosure>}
    </div>
  )
}

// Topics the analysis found no material for.
export function GapList({ gaps }: { gaps: readonly Gap[] }) {
  const titleId = useId()
  if (gaps.length === 0) return null
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2 rounded-xl bg-warning-soft p-4">
      <h2 id={titleId} className="text-base font-semibold text-warning">
        {tp.gapsTitle}
      </h2>
      <ul aria-labelledby={titleId} className="flex list-disc flex-col gap-1 ps-5 text-sm text-ink">
        {gaps.map((gap) => (
          <li key={gap.topic}>{tp.gap(gap.topic, gap.note)}</li>
        ))}
      </ul>
    </section>
  )
}
