import { useId, useState } from 'react'
import { errorMessage, type ApiError } from '../api/client'
import { he } from '../i18n/he'
import type { Block } from '../onboarding/types'
import { Button } from '../ui/Button'
import { useToast } from '../ui/useToast'
import { AddTask } from './AddTask'
import { useDeleteTask, useExamTasks, useExamTopics } from './api'
import { useTaskDeleteFeedback } from './placement'
import { TaskRow } from './TaskRow'
import { nextBlocks } from './timelineDays'
import { GapList, TopicHeader } from './TopicList'
import type { ExamTask, Topic } from './types'

const tp = he.exam.topics

function LoadError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert" className="text-danger">
        {errorMessage(error)}
      </p>
      <Button variant="secondary" onPress={onRetry}>
        {he.common.retry}
      </Button>
    </div>
  )
}

function Group({
  topic,
  tasks,
  render,
}: {
  topic: Topic | null
  tasks: readonly ExamTask[]
  render: (task: ExamTask) => React.ReactNode
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      {topic === null ? (
        <h3 id={headingId} className="text-base font-semibold text-ink">
          {tp.noTopic}
        </h3>
      ) : (
        <TopicHeader topic={topic} headingId={headingId} />
      )}
      {tasks.length === 0 ? null : (
        <ul aria-labelledby={headingId} className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {tasks.map(render)}
        </ul>
      )}
    </section>
  )
}

// The exam's topics in order, each with its tasks, then the tasks with no topic; the gaps; and
// "add task". Blocks come from the timeline's query, for "next on the board".
export function TaskList({ examId, blocks, timeZone }: { examId: string; blocks: readonly Block[]; timeZone: string }) {
  const tasks = useExamTasks(examId)
  const topics = useExamTopics(examId)
  const remove = useDeleteTask()
  const toast = useToast()
  const deleted = useTaskDeleteFeedback()
  const titleId = useId()
  // Tasks whose DELETE is on its way: hidden at once, back if it fails.
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(() => new Set())

  function flag(id: string, on: boolean) {
    setDeleting((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function onDelete(task: ExamTask) {
    flag(task.id, true)
    remove
      .mutateAsync({ taskId: task.id, examId })
      .then((answer) => {
        deleted(answer.version_id)
      })
      .catch((error: unknown) => {
        toast.show({ text: errorMessage(error), tone: 'error' })
      })
      .finally(() => {
        flag(task.id, false)
      })
  }

  const topicList = topics.data?.topics ?? []
  const next = nextBlocks(blocks)
  const visible = (tasks.data ?? []).filter((task) => !deleting.has(task.id))
  const known = new Set(topicList.map((topic) => topic.id))
  const orphan = visible.filter((task) => task.topic_id === null || !known.has(task.topic_id))

  const render = (task: ExamTask) => (
    <TaskRow key={task.id} task={task} topics={topicList} nextBlock={next.get(task.id)} timeZone={timeZone} onDelete={onDelete} />
  )

  let body: React.ReactNode
  if (tasks.isPending || topics.isPending) body = <p className="text-ink-muted">{he.common.loading}</p>
  else if (tasks.isError)
    body = (
      <LoadError
        error={tasks.error}
        onRetry={() => {
          void tasks.refetch()
        }}
      />
    )
  else if (topics.isError)
    body = (
      <LoadError
        error={topics.error}
        onRetry={() => {
          void topics.refetch()
        }}
      />
    )
  else if (visible.length === 0 && topicList.length === 0) body = <p className="text-ink-muted">{tp.empty}</p>
  else
    body = (
      <>
        {topicList.map((topic) => (
          <Group key={topic.id} topic={topic} tasks={visible.filter((task) => task.topic_id === topic.id)} render={render} />
        ))}
        {orphan.length === 0 ? null : <Group topic={null} tasks={orphan} render={render} />}
      </>
    )

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-5">
      <h2 id={titleId} className="text-lg font-medium text-ink">
        {tp.title}
      </h2>
      {body}
      <GapList gaps={topics.data?.gaps ?? []} />
      <AddTask examId={examId} topics={topicList} />
    </section>
  )
}
