import { ChevronDown, ChevronUp, Pencil } from '../ui/icons'
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import { TileRow } from '../ui/TileList'
import { useToast } from '../ui/useToast'
import { UserText } from '../ui/UserText'
import { useUpdateTopic } from './api'
import type { Gap, Topic, TopicPatch } from './types'

const tp = en.exam.topics

const NAME_MAX = 120
const WEIGHT_OPTIONS = [1, 2, 3, 4, 5].map((w) => ({ value: String(w), label: String(w) }))

// Five dots, the first `weight` of them filled: a picture that is named in words, so the weight
// is not carried by colour alone ("Importance 4 of 5").
function Weight({ weight }: { weight: number }) {
  return (
    <span role="img" aria-label={tp.weight(weight)} className="flex shrink-0 gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`size-2 rounded-full ${n <= weight ? 'bg-brand' : 'bg-line-strong'}`} />
      ))}
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

const chevron = { 'aria-hidden': true as const, size: 18, strokeWidth: ICON_STROKE }

// A topic as a tile of its own (S34 decision 10): its name, its five dots, a fold button, and under
// the name how many of its tasks are done; the tasks are the body of the tile. "Edit" opens the form
// of name and weight in place of the tile. The first tile starts open and the others folded, and the choice to fold
// is then the user's. `progress` is { done, total } of the tasks that were not skipped.
export function TopicTile({
  topic,
  defaultOpen,
  progress,
  children,
}: {
  topic: Topic
  // The first topic of the exam starts open and the rest folded, as in the prototype; after that it is the user's.
  defaultOpen: boolean
  progress: { done: number; total: number }
  children: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(defaultOpen)
  // ui/IconButton takes no ref, so the ref is on the head and the button is found inside it.
  const head = useRef<HTMLDivElement>(null)
  // The form replaces the tile; when it closes, the keyboard goes back to the pencil.
  const returnFocus = useRef(false)

  useEffect(() => {
    if (editing || !returnFocus.current) return
    returnFocus.current = false
    head.current?.querySelector('button')?.focus()
  }, [editing])

  if (editing) {
    return (
      <li className="mt-2 first:mt-0">
        <TopicForm
          topic={topic}
          onDone={() => {
            returnFocus.current = true
            setEditing(false)
          }}
        />
      </li>
    )
  }
  const FoldChevron = open ? ChevronUp : ChevronDown
  return (
    <TileRow
      title={
        <div ref={head} className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 text-body font-semibold break-words text-ink">
            <UserText>{topic.name}</UserText>
          </h3>
          <Weight weight={topic.weight} />
          <IconButton
            aria-label={tp.editNamed(topic.name)}
            onPress={() => {
              setEditing(true)
            }}
          >
            <Pencil aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
          </IconButton>
          <IconButton
            aria-label={open ? en.exams.exam.topic.collapse(topic.name) : en.exams.exam.topic.expand(topic.name)}
            aria-expanded={open}
            onPress={() => {
              setOpen((was) => !was)
            }}
          >
            <FoldChevron {...chevron} className="text-ink-muted" />
          </IconButton>
        </div>
      }
      subtitle={<span className="tabular-nums">{progressText(progress)}</span>}
      footer={
        open ? (
          <div className="flex flex-col gap-2">
            {topic.evidence === null || topic.evidence === '' ? null : (
              <Disclosure label={tp.evidence}>
                <UserText prose>{topic.evidence}</UserText>
              </Disclosure>
            )}
            {children}
          </div>
        ) : undefined
      }
    />
  )
}

function progressText({ done, total }: { done: number; total: number }): string {
  return total === 0 ? en.exams.exam.topic.noTasks : en.exams.exam.topic.progress(done, total)
}

// The tasks that have no topic: a tile with the same shape and no dots or edit.
export function NoTopicTile({ progress, children }: { progress: { done: number; total: number }; children: ReactNode }) {
  return (
    <TileRow
      title={
        <h3 className="text-body font-semibold break-words text-ink">
          {tp.noTopic}
        </h3>
      }
      subtitle={<span className="tabular-nums">{progressText(progress)}</span>}
      footer={children}
    />
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
          <li key={gap.topic}>
            <UserText className="font-medium">{gap.topic}</UserText>
            {gap.note === '' ? null : <UserText prose>{gap.note}</UserText>}
          </li>
        ))}
      </List>
    </Card>
  )
}
