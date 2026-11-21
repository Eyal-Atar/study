import { Plus } from '../ui/icons'
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../api/client'
import { en } from '../i18n/en'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ICON_STROKE } from '../ui/styles'
import { useToast } from '../ui/useToast'
import { useCreateTask } from './api'
import { usePlacementFeedback } from './placement'
import { NEW_TASK_DRAFT, type TaskValues } from './taskDraft'
import { TaskForm } from './TaskForm'
import type { TaskCreate, Topic } from './types'

const t = en.exam.tasks

// "הוספת משימה": a user task for this exam (POST /tasks), placed on the board by the server.
export function AddTask({ examId, topics }: { examId: string; topics: readonly Topic[] }) {
  const create = useCreateTask()
  const toast = useToast()
  const feedback = usePlacementFeedback()
  const [open, setOpen] = useState(false)
  // ui/Button takes no ref, so the ref is on a wrapper that adds no box (display: contents).
  const opener = useRef<HTMLSpanElement>(null)
  // The card replaces the button; when it closes, the keyboard goes back to the button.
  const returnFocus = useRef(false)

  useEffect(() => {
    if (open || !returnFocus.current) return
    returnFocus.current = false
    opener.current?.querySelector('button')?.focus()
  }, [open])

  function close() {
    returnFocus.current = true
    setOpen(false)
  }

  if (!open) {
    return (
      <span ref={opener} className="contents">
        <Button
          variant="secondary"
          className="self-start"
          onPress={() => {
            setOpen(true)
          }}
        >
          <Plus aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
          {t.add}
        </Button>
      </span>
    )
  }

  function submit(values: TaskValues) {
    const body: TaskCreate = { exam_id: examId, title: values.title, estimated_minutes: values.minutes, kind: values.kind }
    if (values.topicId !== null) body.topic_id = values.topicId
    create
      .mutateAsync(body)
      .then((answer) => {
        close()
        feedback(answer, { saved: t.added, placed: t.addedPlaced })
      })
      .catch((error: unknown) => {
        toast.show({ text: errorMessage(error), tone: 'error' })
      })
  }

  return (
    <Card title={t.addTitle} titleLevel={3} className="md:max-w-xl">
      <TaskForm
        label={t.addTitle}
        initial={NEW_TASK_DRAFT}
        topics={topics}
        withFocus={false}
        submitLabel={t.add}
        isPending={create.isPending}
        onSubmit={submit}
        onCancel={close}
      />
    </Card>
  )
}
