import { Pencil } from '../ui/icons'
import { useEffect, useRef, useState } from 'react'
import { Form } from 'react-aria-components'
import { errorMessage } from '../api/client'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Disclosure } from '../ui/Disclosure'
import { IconButton } from '../ui/IconButton'
import { List } from '../ui/List'
import { RadioCards } from '../ui/RadioCards'
import { ICON_STROKE } from '../ui/styles'
import { TextField } from '../ui/TextField'
import { useToast } from '../ui/useToast'
import { UserText } from '../ui/UserText'
import { useUpdateTopic } from './api'
import type { Gap, Topic, TopicPatch } from './types'

const tp = en.exam.topics

const NAME_MAX = 120
const WEIGHT_OPTIONS = [1, 2, 3, 4, 5].map((w) => ({ value: String(w), label: String(w) }))

// 1–5 filled dots, and the same thing in words beside them: the dots alone would carry the weight
// by colour only.
function Weight({ weight }: { weight: number }) {
  return (
    <p className="flex items-center gap-2 text-small text-ink-muted">
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`size-2 rounded-full ${n <= weight ? 'bg-brand' : 'bg-line-strong'}`} />
        ))}
      </span>
      <span className="tabular-nums">{tp.weight(weight)}</span>
    </p>
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
      // A quiet fill and no border: the form sits in the place of the head, it is not a card.
      className="flex flex-col gap-4 rounded-control bg-surface-muted p-card"
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
        autoFocus
        autoComplete="off"
        {...(nameError === undefined ? {} : { errorMessage: nameError })}
      />
      <RadioCards label={tp.weightLabel} options={WEIGHT_OPTIONS} value={weight} onChange={setWeight} columns="grid-cols-5" />
      <div className="flex gap-2">
        <Button type="submit" isPending={update.isPending} className="flex-1 sm:flex-none">
          {en.common.save}
        </Button>
        <Button variant="secondary" onPress={onDone}>
          {en.common.cancel}
        </Button>
      </div>
    </Form>
  )
}

// The head of a topic group: name, weight and evidence, with "Edit" for name and weight.
export function TopicHeader({ topic, headingId }: { topic: Topic; headingId: string }) {
  const [editing, setEditing] = useState(false)
  // ui/IconButton takes no ref, so the ref is on the head and the button is found inside it.
  const head = useRef<HTMLDivElement>(null)
  // The form replaces the head; when it closes, the keyboard goes back to the pencil.
  const returnFocus = useRef(false)

  useEffect(() => {
    if (editing || !returnFocus.current) return
    returnFocus.current = false
    head.current?.querySelector('button')?.focus()
  }, [editing])

  if (editing) {
    return (
      <TopicForm
        topic={topic}
        onDone={() => {
          returnFocus.current = true
          setEditing(false)
        }}
      />
    )
  }
  return (
    <div className="flex flex-col">
      <div ref={head} className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id={headingId} className="text-body font-semibold break-words text-ink">
            <UserText>{topic.name}</UserText>
          </h3>
          <Weight weight={topic.weight} />
        </div>
        <IconButton
          aria-label={tp.editNamed(topic.name)}
          onPress={() => {
            setEditing(true)
          }}
        >
          <Pencil aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      {topic.evidence === null || topic.evidence === '' ? null : <Disclosure label={tp.evidence}>
          <UserText prose>{topic.evidence}</UserText>
        </Disclosure>}
    </div>
  )
}

// Topics the analysis found no material for. The card is a region named by its heading, and the
// list carries the same name.
export function GapList({ gaps }: { gaps: readonly Gap[] }) {
  if (gaps.length === 0) return null
  return (
    <Card tone="warning" title={tp.gapsTitle} titleLevel={3} role="region">
      <List aria-label={tp.gapsTitle} className="flex list-disc flex-col gap-1 ps-5 text-small break-words text-ink">
        {gaps.map((gap) => (
          <li key={gap.topic}>{tp.gap(gap.topic, gap.note)}</li>
        ))}
      </List>
    </Card>
  )
}
