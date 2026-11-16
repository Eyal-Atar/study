import { useState } from 'react'
import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { useToast } from '../ui/useToast'
import { useCreateTask } from './api'
import { usePlacementFeedback } from './placement'
import { NEW_TASK_DRAFT, type TaskValues } from './taskDraft'
import { TaskForm } from './TaskForm'
import type { TaskCreate, Topic } from './types'

const t = he.exam.tasks

// "הוספת משימה": a user task for this exam (POST /tasks), placed on the board by the server.
export function AddTask({ examId, topics }: { examId: string; topics: readonly Topic[] }) {
  const create = useCreateTask()
  const toast = useToast()
  const feedback = usePlacementFeedback()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button
        variant="secondary"
        className="self-start"
        onPress={() => {
          setOpen(true)
        }}
      >
        {t.add}
      </Button>
    )
  }

  function submit(values: TaskValues) {
    const body: TaskCreate = { exam_id: examId, title: values.title, estimated_minutes: values.minutes, kind: values.kind }
    if (values.topicId !== null) body.topic_id = values.topicId
    create
      .mutateAsync(body)
      .then((answer) => {
        setOpen(false)
        feedback(answer, { saved: t.added, placed: t.addedPlaced })
      })
      .catch((error: unknown) => {
        toast.show({ text: errorMessage(error), tone: 'error' })
      })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <h3 className="text-base font-semibold text-ink">{t.addTitle}</h3>
      <TaskForm
        label={t.addTitle}
        initial={NEW_TASK_DRAFT}
        topics={topics}
        withFocus={false}
        submitLabel={create.isPending ? t.adding : t.add}
        isPending={create.isPending}
        onSubmit={submit}
        onCancel={() => {
          setOpen(false)
        }}
      />
    </div>
  )
}
