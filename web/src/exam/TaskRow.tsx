import { useState } from 'react'
import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import type { Block } from '../onboarding/types'
import { Button } from '../ui/Button'
import { useToast } from '../ui/useToast'
import { useUpdateTask } from './api'
import { momentIn } from './dates'
import { Disclosure } from './Disclosure'
import { usePlacementFeedback } from './placement'
import { draftOfTask, taskPatch, type TaskValues } from './taskDraft'
import { TaskForm } from './TaskForm'
import type { ExamTask, TaskPatch, TaskStatus, Topic } from './types'

const t = he.exam.tasks

const STATUS_BADGE: Record<TaskStatus, string> = {
  todo: 'bg-surface-muted text-ink-muted',
  done: 'bg-success-soft text-success',
  skipped: 'bg-warning-soft text-warning',
}

function kindLabel(kind: string): string {
  return Object.hasOwn(t.kinds, kind) ? t.kinds[kind as keyof typeof t.kinds] : kind
}

function Chip({ children, className = 'bg-surface-muted text-ink-muted' }: { children: string; className?: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${className}`}>{children}</span>
}

// One task: what it is, when it is next on the board, why it is there, and its actions. "עריכה"
// turns the row into a form; nothing is sent before "שמירה", and only the changed fields.
export function TaskRow({
  task,
  topics,
  nextBlock,
  timeZone,
  onDelete,
}: {
  task: ExamTask
  topics: readonly Topic[]
  nextBlock: Block | undefined
  timeZone: string
  onDelete: (task: ExamTask) => void
}) {
  const update = useUpdateTask()
  const toast = useToast()
  const feedback = usePlacementFeedback()
  const [editing, setEditing] = useState(false)

  function send(body: TaskPatch, after?: () => void) {
    update
      .mutateAsync({ taskId: task.id, examId: task.exam_id, body })
      .then((answer) => {
        after?.()
        feedback(answer, { saved: t.saved, placed: t.placed })
      })
      .catch((error: unknown) => {
        toast.show({ text: errorMessage(error), tone: 'error' })
      })
  }

  function save(values: TaskValues) {
    const body = taskPatch(task, values)
    if (Object.keys(body).length === 0) {
      setEditing(false)
      return
    }
    send(body, () => {
      setEditing(false)
    })
  }

  if (editing) {
    return (
      <li className="bg-surface-muted px-4 py-4">
        <TaskForm
          label={t.formLabel(task.title)}
          initial={draftOfTask(task)}
          topics={topics}
          withFocus
          submitLabel={he.common.save}
          isPending={update.isPending}
          onSubmit={save}
          onCancel={() => {
            setEditing(false)
          }}
        />
      </li>
    )
  }

  const finished = task.status !== 'todo'
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start gap-2">
        <span
          className={`min-w-0 flex-1 break-words font-medium ${finished ? 'text-ink-muted line-through decoration-1' : 'text-ink'}`}
        >
          {task.title}
        </span>
        <Chip className={STATUS_BADGE[task.status]}>{t.statuses[task.status]}</Chip>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip>{kindLabel(task.kind)}</Chip>
        <Chip>{t.minutes(task.estimated_minutes)}</Chip>
        <Chip>{t.focus(task.focus)}</Chip>
      </div>
      {finished ? null : (
        <p className="text-sm text-ink-muted">
          {nextBlock === undefined ? t.notOnBoard : t.next(momentIn(nextBlock.starts_at, timeZone))}
        </p>
      )}
      {task.reason === null || task.reason === '' ? null : <Disclosure label={t.reason}>{task.reason}</Disclosure>}
      <div className="flex flex-wrap gap-2">
        {finished ? (
          <Button
            variant="secondary"
            aria-label={t.backToTodoNamed(task.title)}
            isDisabled={update.isPending}
            onPress={() => {
              send({ status: 'todo' })
            }}
          >
            {t.backToTodo}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              aria-label={t.markDoneNamed(task.title)}
              isDisabled={update.isPending}
              onPress={() => {
                send({ status: 'done' })
              }}
            >
              {t.markDone}
            </Button>
            <Button
              variant="secondary"
              aria-label={t.skipNamed(task.title)}
              isDisabled={update.isPending}
              onPress={() => {
                send({ status: 'skipped' })
              }}
            >
              {t.skip}
            </Button>
          </>
        )}
        <Button
          variant="quiet"
          aria-label={t.editNamed(task.title)}
          onPress={() => {
            setEditing(true)
          }}
        >
          {t.edit}
        </Button>
        <Button
          variant="danger"
          aria-label={t.deleteNamed(task.title)}
          onPress={() => {
            onDelete(task)
          }}
        >
          {t.delete}
        </Button>
      </div>
    </li>
  )
}
