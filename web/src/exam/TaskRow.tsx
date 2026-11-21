import { CircleSlash, Ellipsis, Info, Pencil, RotateCcw, Trash2 } from '../ui/icons'
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../api/client'
import { en } from '../i18n/en'
import type { Block } from '../onboarding/types'
import { Badge } from '../ui/Badge'
import { CheckButton } from '../ui/CheckButton'
import { IconButton } from '../ui/IconButton'
import { ListRow } from '../ui/List'
import { Menu, MenuItem } from '../ui/Menu'
import { Note } from '../ui/Note'
import { ICON_STROKE } from '../ui/styles'
import { useToast } from '../ui/useToast'
import { useUpdateTask } from './api'
import { momentIn } from './dates'
import { usePlacementFeedback } from './placement'
import { draftOfTask, taskPatch, type TaskValues } from './taskDraft'
import { TaskForm } from './TaskForm'
import type { ExamTask, TaskPatch, Topic } from './types'

const t = en.exam.tasks

function kindLabel(kind: string): string {
  return Object.hasOwn(t.kinds, kind) ? t.kinds[kind as keyof typeof t.kinds] : kind
}

// One task, as a row: its name, one line of details, why it is there, the check button and a menu
// with the rest of the actions (design language 5.2). "עריכה" turns the row into a form; nothing is
// sent before "שמירה", and only the changed fields.
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
  const [showReason, setShowReason] = useState(false)
  // ui/Button and ui/IconButton take no ref, so the ref is on a wrapper that adds no box
  // (display: contents) and the button is found inside it.
  const menuWrap = useRef<HTMLSpanElement>(null)
  // The form replaces the row, so the button that opened it is gone while it is open. When the
  // form closes, the keyboard goes back to the menu of the row instead of to the top of the page.
  const returnFocus = useRef(false)

  useEffect(() => {
    if (editing || !returnFocus.current) return
    returnFocus.current = false
    menuWrap.current?.querySelector('button')?.focus()
  }, [editing])

  function closeForm() {
    returnFocus.current = true
    setEditing(false)
  }

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
      closeForm()
      return
    }
    send(body, closeForm)
  }

  if (editing) {
    return (
      // The same line under it as a row, so the list keeps its rhythm while one row is a form.
      <li className="border-b border-line py-2">
        <div className="rounded-control bg-surface-muted p-card">
          <TaskForm
            label={t.formLabel(task.title)}
            initial={draftOfTask(task)}
            topics={topics}
            withFocus
            submitLabel={en.common.save}
            isPending={update.isPending}
            onSubmit={save}
            onCancel={closeForm}
          />
        </div>
      </li>
    )
  }

  const finished = task.status !== 'todo'
  const hasReason = task.reason !== null && task.reason !== ''
  return (
    <ListRow
      title={task.title}
      done={finished}
      subtitle={
        <>
          <p className="tabular-nums">
            {t.details(kindLabel(task.kind), t.minutes(task.estimated_minutes), t.focus(task.focus))}
            {finished ? null : (
              <>
                {'. '}
                {/* One piece: the day and the hour of the block are never split over two lines. */}
                <span className="whitespace-nowrap">
                  {nextBlock === undefined ? t.notOnBoard : t.next(momentIn(nextBlock.starts_at, timeZone))}
                </span>
              </>
            )}
          </p>
          {hasReason && showReason ? (
            <div className="mt-2">
              <Note role="status">{task.reason}</Note>
            </div>
          ) : null}
        </>
      }
      trailing={
        <>
          {task.status === 'skipped' ? (
            <Badge tone="neutral">{t.skipped}</Badge>
          ) : (
            <CheckButton
              isDone={task.status === 'done'}
              aria-label={t.markDoneNamed(task.title)}
              isDisabled={update.isPending}
              onChange={(isDone) => {
                send({ status: isDone ? 'done' : 'todo' })
              }}
            />
          )}
          <span ref={menuWrap} className="contents">
            <Menu
              trigger={
                <IconButton aria-label={t.actionsNamed(task.title)}>
                  <Ellipsis aria-hidden="true" size={18} strokeWidth={ICON_STROKE} />
                </IconButton>
              }
            >
              <MenuItem
                icon={Pencil}
                onAction={() => {
                  setEditing(true)
                }}
              >
                {t.edit}
              </MenuItem>
              {/* The reason is a detail most students do not need: it opens from the menu, so a
                  row is two lines and the list has no link on every row. */}
              {hasReason ? (
                <MenuItem
                  icon={Info}
                  onAction={() => {
                    setShowReason((shown) => !shown)
                  }}
                >
                  {showReason ? t.hideReason : t.reason}
                </MenuItem>
              ) : null}
              {finished ? (
                <MenuItem
                  icon={RotateCcw}
                  isDisabled={update.isPending}
                  onAction={() => {
                    send({ status: 'todo' })
                  }}
                >
                  {t.backToTodo}
                </MenuItem>
              ) : (
                <MenuItem
                  icon={CircleSlash}
                  isDisabled={update.isPending}
                  onAction={() => {
                    send({ status: 'skipped' })
                  }}
                >
                  {t.skip}
                </MenuItem>
              )}
              <MenuItem
                icon={Trash2}
                tone="danger"
                onAction={() => {
                  onDelete(task)
                }}
              >
                {t.delete}
              </MenuItem>
            </Menu>
          </span>
        </>
      }
    />
  )
}
