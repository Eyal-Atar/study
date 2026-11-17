import { ListChecks } from 'lucide-react'
import { useId, useState } from 'react'
import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import type { Block } from '../onboarding/types'
import { List } from '../ui/List'
import { SectionHeading } from '../ui/SectionHeading'
import { EmptyState, ErrorState, LoadingState } from '../ui/states'
import { useToast } from '../ui/useToast'
import { AddTask } from './AddTask'
import { useDeleteTask, useExamTasks, useExamTopics } from './api'
import { useTaskDeleteFeedback } from './placement'
import { TaskRow } from './TaskRow'
import { nextBlocks } from './timelineDays'
import { GapList, TopicHeader } from './TopicList'
import type { ExamTask, Topic } from './types'

const tp = he.exam.topics

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
        <h3 id={headingId} className="text-body font-semibold text-ink">
          {tp.noTopic}
        </h3>
      ) : (
        <TopicHeader topic={topic} headingId={headingId} />
      )}
      {tasks.length === 0 ? null : (
        // The line above the first row closes the head of the group, like the line under each row.
        <List aria-label={topic === null ? tp.noTopic : topic.name} className="border-t border-line">
          {tasks.map(render)}
        </List>
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
  if (tasks.isPending || topics.isPending) body = <LoadingState shape="list" rows={4} />
  else if (tasks.isError)
    body = (
      <ErrorState
        message={errorMessage(tasks.error)}
        onRetry={() => {
          void tasks.refetch()
        }}
      />
    )
  else if (topics.isError)
    body = (
      <ErrorState
        message={errorMessage(topics.error)}
        onRetry={() => {
          void topics.refetch()
        }}
      />
    )
  else if (visible.length === 0 && topicList.length === 0) body = <EmptyState icon={ListChecks} title={tp.empty} description={tp.emptyHint} />
  else
    body = (
      <div className="flex flex-col gap-6">
        {topicList.map((topic) => (
          <Group key={topic.id} topic={topic} tasks={visible.filter((task) => task.topic_id === topic.id)} render={render} />
        ))}
        {orphan.length === 0 ? null : <Group topic={null} tasks={orphan} render={render} />}
      </div>
    )

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <SectionHeading id={titleId}>{tp.title}</SectionHeading>
      {body}
      <GapList gaps={topics.data?.gaps ?? []} />
      <AddTask examId={examId} topics={topicList} />
    </section>
  )
}
