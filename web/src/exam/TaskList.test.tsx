import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { unscheduledText } from '../i18n/codes'
import { he } from '../i18n/he'
import { problem, type ApiCall } from '../test/fakeApi'
import { momentIn } from './dates'
import { BROWSER_ZONE } from '../onboarding/testFixtures'
import { blockFixture, examServer, openRoute, taskFixture, topicFixture, topicsFixture } from './testFixtures'
import type { TaskWriteResponse } from './types'

const t = he.exam.tasks
const tp = he.exam.topics

const TASKS = [
  taskFixture({ id: 't1', title: 'גבולות', topic_id: 'p1', reason: 'מופיע בכל מבחן עבר.', estimated_minutes: 60, focus: 7 }),
  taskFixture({ id: 't2', title: 'כלל השרשרת', topic_id: 'p2', kind: 'practice', status: 'done' }),
  taskFixture({ id: 't3', title: 'שאלות של המתרגל', topic_id: null, source: 'user', kind: 'custom', reason: null }),
]
const TOPICS = topicsFixture({
  topics: [topicFixture({ id: 'p2', name: 'נגזרות', weight: 3, position: 1 }), topicFixture({ id: 'p1', name: 'גבולות ורציפות', weight: 5, position: 2, evidence: 'שאלה 2 בכל מבחן עבר' })],
  gaps: [{ topic: 'אינטגרלים', note: 'אין עליהם חומר' }],
})

function server() {
  return examServer({ tasks: TASKS, topics: TOPICS, blocks: [blockFixture({ task_id: 't1' })] })
}

function written(overrides: Partial<TaskWriteResponse> = {}): TaskWriteResponse {
  return { task: TASKS[0] ?? taskFixture(), placement: null, version_id: null, ...overrides }
}

async function open(fake = server()) {
  openRoute(fake, '/exams/e1')
  await screen.findByText('גבולות')
  return fake
}

function row(title: string) {
  const item = screen.getByText(title).closest('li')
  if (item === null) throw new Error(`no row for ${title}`)
  return item
}

describe('TaskList', () => {
  it('groups the tasks under their topics in topic order, then the tasks without a topic', async () => {
    await open()
    const groups = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(groups).toEqual(['נגזרות', 'גבולות ורציפות', tp.noTopic])
    const limits = screen.getByRole('list', { name: 'גבולות ורציפות' })
    expect(within(limits).getByText('גבולות')).toBeInTheDocument()
    const none = screen.getByRole('list', { name: tp.noTopic })
    expect(within(none).getByText('שאלות של המתרגל')).toBeInTheDocument()
  })

  it('shows a task with its kind, minutes, focus, next block and a collapsed reason', async () => {
    const user = userEvent.setup()
    await open()
    const item = row('גבולות')
    expect(item).toHaveTextContent(t.kinds.learn)
    expect(item).toHaveTextContent(t.minutes(60))
    expect(item).toHaveTextContent(t.focus(7))
    expect(item).toHaveTextContent(t.next(momentIn(blockFixture().starts_at, BROWSER_ZONE)))
    const disclosure = within(item).getByRole('button', { name: t.reason })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(within(item).queryByText('מופיע בכל מבחן עבר.')).not.toBeVisible()
    await user.click(disclosure)
    expect(within(item).getByText('מופיע בכל מבחן עבר.')).toBeVisible()
    // A user task has no reason to show.
    expect(within(row('שאלות של המתרגל')).queryByRole('button', { name: t.reason })).not.toBeInTheDocument()
  })

  it('marks a done task and offers to take it back to todo', async () => {
    await open()
    const item = row('כלל השרשרת')
    expect(item).toHaveTextContent(t.statuses.done)
    expect(within(item).getByRole('button', { name: t.backToTodoNamed('כלל השרשרת') })).toBeInTheDocument()
  })

  it('shows the topic weight as text and the gaps', async () => {
    await open()
    expect(screen.getByText(tp.weight(5))).toBeInTheDocument()
    const gaps = screen.getByRole('list', { name: tp.gapsTitle })
    expect(gaps).toHaveTextContent(tp.gap('אינטגרלים', 'אין עליהם חומר'))
  })

  it('edits a task in place: PATCH with only the changed fields, and a placed answer toasts with בטל that undoes', async () => {
    const user = userEvent.setup()
    const fake = server()
      .on('PATCH /tasks/t1', written({ placement: { placed: true, reason: null, blocked_by: null }, version_id: 'v7' }))
      .on('POST /plan/undo', { restored: 1, deleted: 1, replaced: [], unplaced: [] })
    await open(fake)
    await user.click(within(row('גבולות')).getByRole('button', { name: t.editNamed('גבולות') }))
    const form = screen.getByRole('form', { name: t.formLabel('גבולות') })
    const minutes = within(form).getByRole('textbox', { name: t.minutesLabel })
    await user.clear(minutes)
    await user.type(minutes, '90')
    await user.click(within(form).getByRole('button', { name: he.common.save }))

    await waitFor(() => {
      expect(fake.calls('PATCH', '/tasks/t1').map((c) => c.body)).toEqual([{ estimated_minutes: 90 }])
    })
    const toast = await screen.findByRole('region', { name: he.common.notifications })
    await within(toast).findByText(t.placed)
    await user.click(within(toast).getByRole('button', { name: he.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/undo').map((c) => c.body)).toEqual([{ version_id: 'v7' }])
    })
  })

  it('an unchanged save sends nothing', async () => {
    const user = userEvent.setup()
    const fake = await open()
    await user.click(within(row('גבולות')).getByRole('button', { name: t.editNamed('גבולות') }))
    await user.click(screen.getByRole('button', { name: he.common.save }))
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: t.formLabel('גבולות') })).not.toBeInTheDocument()
    })
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('moves a task to no topic: topic_id null, and a null placement just says saved', async () => {
    const user = userEvent.setup()
    const fake = server().on('PATCH /tasks/t1', written())
    await open(fake)
    await user.click(within(row('גבולות')).getByRole('button', { name: t.editNamed('גבולות') }))
    await user.selectOptions(screen.getByRole('combobox', { name: t.topic }), tp.noTopic)
    await user.click(screen.getByRole('button', { name: he.common.save }))
    await waitFor(() => {
      expect(fake.calls('PATCH', '/tasks/t1').map((c) => c.body)).toEqual([{ topic_id: null }])
    })
    expect(await screen.findByText(t.saved)).toBeInTheDocument()
  })

  it('a placement that did not fit opens the replan offer with the reason', async () => {
    const user = userEvent.setup()
    const fake = server().on(
      'PATCH /tasks/t1',
      written({ placement: { placed: false, reason: 'not_enough_time', blocked_by: null }, version_id: null }),
    )
    await open(fake)
    await user.click(within(row('גבולות')).getByRole('button', { name: t.editNamed('גבולות') }))
    const minutes = screen.getByRole('textbox', { name: t.minutesLabel })
    await user.clear(minutes)
    await user.type(minutes, '300')
    await user.click(screen.getByRole('button', { name: he.common.save }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(t.notPlaced(unscheduledText('not_enough_time')))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/replan')).toHaveLength(1)
    })
  })

  it('out-of-range minutes show an error and send nothing', async () => {
    const user = userEvent.setup()
    const fake = await open()
    await user.click(within(row('גבולות')).getByRole('button', { name: t.editNamed('גבולות') }))
    const minutes = screen.getByRole('textbox', { name: t.minutesLabel })
    await user.clear(minutes)
    await user.type(minutes, '2')
    await user.click(screen.getByRole('button', { name: he.common.save }))
    expect(await screen.findByText(t.minutesRange)).toBeInTheDocument()
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('quick actions send the status', async () => {
    const user = userEvent.setup()
    const fake = server().on({ method: 'PATCH', path: /^\/tasks\// }, written())
    await open(fake)
    await user.click(within(row('גבולות')).getByRole('button', { name: t.markDoneNamed('גבולות') }))
    await user.click(within(row('כלל השרשרת')).getByRole('button', { name: t.backToTodoNamed('כלל השרשרת') }))
    await waitFor(() => {
      expect(fake.calls('PATCH').map((c) => [c.path, c.body])).toEqual([
        ['/tasks/t1', { status: 'done' }],
        ['/tasks/t2', { status: 'todo' }],
      ])
    })
  })

  it('deletes a task at once, and בטל sends the undo with its version', async () => {
    const user = userEvent.setup()
    let tasks = [...TASKS]
    const fake = server()
      .on({ method: 'GET', path: /^\/exams\/e1\/tasks$/ }, () => tasks)
      .on('DELETE /tasks/t3', () => {
        tasks = tasks.filter((x) => x.id !== 't3')
        return { version_id: 'v9' }
      })
      .on('POST /plan/undo', () => {
        tasks = [...TASKS]
        return { restored: 1, deleted: 0, replaced: [], unplaced: [] }
      })
    await open(fake)
    await user.click(within(row('שאלות של המתרגל')).getByRole('button', { name: t.deleteNamed('שאלות של המתרגל') }))
    await waitFor(() => {
      expect(fake.calls('DELETE', '/tasks/t3')).toHaveLength(1)
    })
    const toast = await screen.findByRole('region', { name: he.common.notifications })
    await within(toast).findByText(t.deleted)
    await waitFor(() => {
      expect(screen.queryByText('שאלות של המתרגל')).not.toBeInTheDocument()
    })
    await user.click(within(toast).getByRole('button', { name: he.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/undo').map((c) => c.body)).toEqual([{ version_id: 'v9' }])
    })
    expect(await screen.findByText('שאלות של המתרגל')).toBeInTheDocument()
  })

  it('a task write and its undo refetch the topics (an old topic shows only while a live task points at it)', async () => {
    const user = userEvent.setup()
    const fake = server()
      .on('DELETE /tasks/t3', { version_id: 'v9' })
      .on('POST /plan/undo', { restored: 1, deleted: 0, replaced: [], unplaced: [] })
    await open(fake)
    const topicCalls = () => fake.calls('GET', '/exams/e1/topics').length
    const initial = topicCalls()
    await user.click(within(row('שאלות של המתרגל')).getByRole('button', { name: t.deleteNamed('שאלות של המתרגל') }))
    await waitFor(() => {
      expect(topicCalls()).toBeGreaterThan(initial)
    })
    const afterWrite = topicCalls()
    const toast = await screen.findByRole('region', { name: he.common.notifications })
    await user.click(await within(toast).findByRole('button', { name: he.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/undo')).toHaveLength(1)
    })
    await waitFor(() => {
      expect(topicCalls()).toBeGreaterThan(afterWrite)
    })
  })

  it('a mutation error is a toast, and a 404 refetches the tasks', async () => {
    const user = userEvent.setup()
    const fake = server().on('PATCH /tasks/t1', problem(404, 'not_found'))
    await open(fake)
    const before = fake.calls('GET', '/exams/e1/tasks').length
    await user.click(within(row('גבולות')).getByRole('button', { name: t.markDoneNamed('גבולות') }))
    expect(await screen.findByText(he.codes.not_found)).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/exams/e1/tasks').length).toBeGreaterThan(before)
    })
  })

  it('edits a topic name and weight: PATCH /topics/{id}', async () => {
    const user = userEvent.setup()
    const fake = server().on('PATCH /topics/p2', (call: ApiCall) => ({ ...topicFixture({ id: 'p2' }), ...(call.body as object) }))
    await open(fake)
    await user.click(screen.getByRole('button', { name: tp.editNamed('נגזרות') }))
    const name = screen.getByRole('textbox', { name: tp.name })
    await user.clear(name)
    await user.type(name, 'נגזרות וחקירה')
    await user.click(screen.getByRole('radio', { name: '5' }))
    await user.click(screen.getByRole('button', { name: he.common.save }))
    await waitFor(() => {
      expect(fake.calls('PATCH', '/topics/p2').map((c) => c.body)).toEqual([{ name: 'נגזרות וחקירה', weight: 5 }])
    })
  })
})

describe('AddTask', () => {
  it('adds a task: POST /tasks, and a placed answer toasts with בטל', async () => {
    const user = userEvent.setup()
    const fake = server().on(
      'POST /tasks',
      written({ placement: { placed: true, reason: null, blocked_by: null }, version_id: 'v3' }),
    )
    await open(fake)
    await user.click(screen.getByRole('button', { name: t.add }))
    await user.type(screen.getByRole('textbox', { name: t.title }), 'חזרה על תרגיל 4')
    const minutes = screen.getByRole('textbox', { name: t.minutesLabel })
    await user.clear(minutes)
    await user.type(minutes, '45')
    await user.selectOptions(screen.getByRole('combobox', { name: t.topic }), 'נגזרות')
    await user.click(screen.getByRole('button', { name: t.add }))
    await waitFor(() => {
      expect(fake.calls('POST', '/tasks').map((c) => c.body)).toEqual([
        { exam_id: 'e1', title: 'חזרה על תרגיל 4', estimated_minutes: 45, kind: 'custom', topic_id: 'p2' },
      ])
    })
    const toast = await screen.findByRole('region', { name: he.common.notifications })
    await within(toast).findByText(t.addedPlaced)
    expect(within(toast).getByRole('button', { name: he.common.undo })).toBeInTheDocument()
  })

  it('a new task that did not fit opens the replan offer', async () => {
    const user = userEvent.setup()
    const fake = server().on(
      'POST /tasks',
      written({ placement: { placed: false, reason: 'no_contiguous_window', blocked_by: null } }),
    )
    await open(fake)
    await user.click(screen.getByRole('button', { name: t.add }))
    await user.type(screen.getByRole('textbox', { name: t.title }), 'סימולציה')
    await user.click(screen.getByRole('button', { name: t.add }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(unscheduledText('no_contiguous_window'))
  })
})
