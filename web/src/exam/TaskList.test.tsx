import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { unscheduledText } from '../i18n/codes'
import { en } from '../i18n/en'
import { problem, type ApiCall } from '../test/fakeApi'
import { momentIn } from './dates'
import { BROWSER_ZONE } from '../test/onboardingFixtures'
import { blockFixture, examServer, openRoute, taskFixture, topicFixture, topicsFixture } from '../test/examFixtures'
import type { TaskWriteResponse } from './types'

const t = en.exam.tasks
const tp = en.exam.topics

const LONG_TITLE = 'א'.repeat(120)

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

type User = ReturnType<typeof userEvent.setup>

// The actions of a row other than the check button live in its menu ("פעולות: …").
async function choose(user: User, title: string, action: string) {
  await user.click(within(row(title)).getByRole('button', { name: t.actionsNamed(title) }))
  await user.click(await screen.findByRole('menuitem', { name: action }))
}

// Picks a topic in the task form. React Aria's Select is a button named by its value and its label
// ("נגזרות נושא"), which opens a listbox.
async function chooseTopic(user: User, name: string) {
  await user.click(screen.getByRole('button', { name: new RegExp(` ${t.topic}$`) }))
  await user.click(within(screen.getByRole('listbox', { name: t.topic })).getByRole('option', { name }))
}

describe('TaskList', () => {
  it('groups the tasks under their topics in topic order, then the tasks without a topic', async () => {
    await open()
    const groups = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    // The card of the gaps is the last part of the section, with a heading of the same level.
    expect(groups).toEqual(['נגזרות', 'גבולות ורציפות', tp.noTopic, tp.gapsTitle])
    const limits = screen.getByRole('list', { name: 'גבולות ורציפות' })
    expect(within(limits).getByText('גבולות')).toBeInTheDocument()
    const none = screen.getByRole('list', { name: tp.noTopic })
    expect(within(none).getByText('שאלות של המתרגל')).toBeInTheDocument()
  })

  it('user content (task title, topic name, evidence, reason) takes its own direction', async () => {
    const user = userEvent.setup()
    await open()
    const dirAuto = (el: HTMLElement) => {
      expect(el.closest('[dir="auto"]')).not.toBeNull()
    }
    const item = row('גבולות')
    dirAuto(within(item).getByText('גבולות'))
    dirAuto(within(screen.getByRole('heading', { level: 3, name: 'גבולות ורציפות' })).getByText('גבולות ורציפות'))
    await user.click(within(item).getByRole('button', { name: t.actionsNamed('גבולות') }))
    await user.click(await screen.findByRole('menuitem', { name: t.reason }))
    dirAuto(within(item).getByText('מופיע בכל מבחן עבר.'))
  })

  it('shows a task with its kind, minutes, focus, next block and a collapsed reason', async () => {
    const user = userEvent.setup()
    await open()
    const item = row('גבולות')
    expect(item).toHaveTextContent(t.kinds.learn)
    expect(item).toHaveTextContent(t.minutes(60))
    expect(item).toHaveTextContent(t.focus(7))
    // One line of details, with a comma and a period and no middle dot.
    expect(item).toHaveTextContent(`${t.kinds.learn}, ${t.minutes(60)}. ${t.focus(7)}. `)
    expect(item).not.toHaveTextContent('·')
    expect(item).toHaveTextContent(t.next(momentIn(blockFixture().starts_at, BROWSER_ZONE)))
    // The reason opens from the row's menu, and closes from it.
    expect(within(item).queryByText('מופיע בכל מבחן עבר.')).not.toBeInTheDocument()
    await user.click(within(item).getByRole('button', { name: t.actionsNamed('גבולות') }))
    await user.click(await screen.findByRole('menuitem', { name: t.reason }))
    expect(within(item).getByText('מופיע בכל מבחן עבר.')).toBeVisible()
    await user.click(within(item).getByRole('button', { name: t.actionsNamed('גבולות') }))
    await user.click(await screen.findByRole('menuitem', { name: t.hideReason }))
    expect(within(item).queryByText('מופיע בכל מבחן עבר.')).not.toBeInTheDocument()
    // A user task has no reason to show.
    await user.click(within(row('שאלות של המתרגל')).getByRole('button', { name: t.actionsNamed('שאלות של המתרגל') }))
    await screen.findByRole('menuitem', { name: t.edit })
    expect(screen.queryByRole('menuitem', { name: t.reason })).not.toBeInTheDocument()
  })

  it('marks a done task and offers to take it back to todo', async () => {
    const user = userEvent.setup()
    await open()
    const item = row('כלל השרשרת')
    // Done is the pressed check and the struck-through title, not a colour alone.
    expect(within(item).getByRole('button', { name: t.markDoneNamed('כלל השרשרת') })).toHaveAttribute('aria-pressed', 'true')
    expect(within(item).getByText('כלל השרשרת').parentElement).toHaveClass('line-through')
    expect(within(row('גבולות')).getByRole('button', { name: t.markDoneNamed('גבולות') })).toHaveAttribute('aria-pressed', 'false')
    // A finished task says nothing about the board.
    expect(item).not.toHaveTextContent(t.notOnBoard)
    await user.click(within(item).getByRole('button', { name: t.actionsNamed('כלל השרשרת') }))
    expect(await screen.findByRole('menuitem', { name: t.backToTodo })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: t.skip })).not.toBeInTheDocument()
  })

  it('a skipped task shows the badge instead of the check, and goes back to todo from the menu', async () => {
    const user = userEvent.setup()
    const fake = examServer({ tasks: [taskFixture({ id: 't9', title: 'חזרה כללית', status: 'skipped' })], topics: TOPICS }).on(
      'PATCH /tasks/t9',
      written(),
    )
    openRoute(fake, '/exams/e1')
    await screen.findByText('חזרה כללית')
    const item = row('חזרה כללית')
    expect(item).toHaveTextContent(t.skipped)
    expect(within(item).getByText('חזרה כללית').parentElement).toHaveClass('line-through')
    expect(within(item).queryByRole('button', { name: t.markDoneNamed('חזרה כללית') })).not.toBeInTheDocument()
    await choose(user, 'חזרה כללית', t.backToTodo)
    await waitFor(() => {
      expect(fake.calls('PATCH', '/tasks/t9').map((c) => c.body)).toEqual([{ status: 'todo' }])
    })
  })

  it('shows the topic weight as text and the gaps', async () => {
    await open()
    // Visible words beside the dots: the weight is not carried by colour alone.
    expect(screen.getByText(tp.weight(5))).toBeVisible()
    expect(screen.getByText(tp.weight(5))).not.toHaveClass('sr-only')
    expect(screen.getByRole('region', { name: tp.gapsTitle })).toBeInTheDocument()
    const gaps = screen.getByRole('list', { name: tp.gapsTitle })
    expect(gaps).toHaveTextContent('אינטגרלים')
    // The topic and the note are user content: each takes its own direction.
    expect(screen.getByText('אינטגרלים').closest('[dir="auto"]')).not.toBeNull()
    expect(screen.getByText('אין עליהם חומר').closest('[dir="auto"]')).not.toBeNull()
  })

  it('edits a task in place: PATCH with only the changed fields, and a placed answer toasts with בטל that undoes', async () => {
    const user = userEvent.setup()
    const fake = server()
      .on('PATCH /tasks/t1', written({ placement: { placed: true, reason: null, blocked_by: null }, version_id: 'v7' }))
      .on('POST /plan/undo', { restored: 1, deleted: 1, replaced: [], unplaced: [] })
    await open(fake)
    await choose(user, 'גבולות', t.edit)
    const form = screen.getByRole('form', { name: t.formLabel('גבולות') })
    const minutes = within(form).getByRole('textbox', { name: t.minutesLabel })
    await user.clear(minutes)
    await user.type(minutes, '90')
    await user.click(within(form).getByRole('button', { name: en.common.save }))

    await waitFor(() => {
      expect(fake.calls('PATCH', '/tasks/t1').map((c) => c.body)).toEqual([{ estimated_minutes: 90 }])
    })
    const toast = await screen.findByRole('region', { name: en.common.notifications })
    await within(toast).findByText(t.placed)
    await user.click(within(toast).getByRole('button', { name: en.common.undo }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/undo').map((c) => c.body)).toEqual([{ version_id: 'v7' }])
    })
  })

  it('an unchanged save sends nothing', async () => {
    const user = userEvent.setup()
    const fake = await open()
    await choose(user, 'גבולות', t.edit)
    await user.click(screen.getByRole('button', { name: en.common.save }))
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: t.formLabel('גבולות') })).not.toBeInTheDocument()
    })
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('moves a task to no topic: topic_id null, and a null placement just says saved', async () => {
    const user = userEvent.setup()
    const fake = server().on('PATCH /tasks/t1', written())
    await open(fake)
    await choose(user, 'גבולות', t.edit)
    await chooseTopic(user, tp.noTopic)
    await user.click(screen.getByRole('button', { name: en.common.save }))
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
    await choose(user, 'גבולות', t.edit)
    const minutes = screen.getByRole('textbox', { name: t.minutesLabel })
    await user.clear(minutes)
    await user.type(minutes, '300')
    await user.click(screen.getByRole('button', { name: en.common.save }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(t.notPlaced(unscheduledText('not_enough_time')))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/replan')).toHaveLength(1)
    })
  })

  it('out-of-range minutes show an error and send nothing', async () => {
    const user = userEvent.setup()
    const fake = await open()
    await choose(user, 'גבולות', t.edit)
    const minutes = screen.getByRole('textbox', { name: t.minutesLabel })
    await user.clear(minutes)
    await user.type(minutes, '2')
    await user.click(screen.getByRole('button', { name: en.common.save }))
    expect(await screen.findByText(t.minutesRange)).toBeInTheDocument()
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('quick actions send the status', async () => {
    const user = userEvent.setup()
    const fake = server().on({ method: 'PATCH', path: /^\/tasks\// }, written())
    await open(fake)
    await user.click(within(row('גבולות')).getByRole('button', { name: t.markDoneNamed('גבולות') }))
    // The check of a done task has the same name, and takes it back.
    await user.click(within(row('כלל השרשרת')).getByRole('button', { name: t.markDoneNamed('כלל השרשרת') }))
    await waitFor(() => {
      expect(fake.calls('PATCH').map((c) => [c.path, c.body])).toEqual([
        ['/tasks/t1', { status: 'done' }],
        ['/tasks/t2', { status: 'todo' }],
      ])
    })
  })

  it('the menu of a row skips a task, and takes a done task back', async () => {
    const user = userEvent.setup()
    const fake = server().on({ method: 'PATCH', path: /^\/tasks\// }, written())
    await open(fake)
    await choose(user, 'שאלות של המתרגל', t.skip)
    await waitFor(() => {
      expect(fake.calls('PATCH')).toHaveLength(1)
    })
    await choose(user, 'כלל השרשרת', t.backToTodo)
    await waitFor(() => {
      expect(fake.calls('PATCH').map((c) => [c.path, c.body])).toEqual([
        ['/tasks/t3', { status: 'skipped' }],
        ['/tasks/t2', { status: 'todo' }],
      ])
    })
  })

  // Review Focus 1. jsdom has no layout, so this checks what keeps the row inside 390px: the text
  // column may shrink and breaks a word, and the controls at the end never shrink.
  it('a long title without spaces wraps, and the check and the menu stay in the row', async () => {
    openRoute(examServer({ tasks: [taskFixture({ id: 't8', title: LONG_TITLE, reason: 'כי כך' })], topics: TOPICS }), '/exams/e1')
    const title = await screen.findByText(LONG_TITLE)
    // The title is user text (a bdi); its parent carries the wrapping classes.
    expect(title.parentElement).toHaveClass('break-words')
    expect(title.parentElement?.parentElement).toHaveClass('min-w-0', 'flex-1')
    const item = row(LONG_TITLE)
    const check = within(item).getByRole('button', { name: t.markDoneNamed(LONG_TITLE) })
    const menu = within(item).getByRole('button', { name: t.actionsNamed(LONG_TITLE) })
    // Both sit in the end column of the row.
    expect(check.parentElement).toContainElement(menu)
    expect(check.parentElement).toHaveClass('shrink-0')
    expect(check).toHaveClass('size-touch', 'shrink-0')
    expect(menu).toHaveClass('size-touch', 'shrink-0')
    // Nothing of the row forbids wrapping around the title.
    for (let el: HTMLElement | null = title; el !== null && el !== item; el = el.parentElement) {
      expect(el.className).not.toMatch(/whitespace-nowrap|truncate|overflow-x/)
    }
  })

  it('a long topic name without spaces wraps beside its edit button', async () => {
    const topics = topicsFixture({ topics: [topicFixture({ id: 'p1', name: LONG_TITLE })] })
    openRoute(examServer({ tasks: [taskFixture()], topics }), '/exams/e1')
    const heading = await screen.findByRole('heading', { level: 3, name: LONG_TITLE })
    expect(heading).toHaveClass('break-words')
    expect(heading.parentElement).toHaveClass('min-w-0', 'flex-1')
    expect(screen.getByRole('button', { name: tp.editNamed(LONG_TITLE) })).toHaveClass('size-touch', 'shrink-0')
  })

  // Review Focus 2.
  it('keyboard: Tab reaches the check and then the menu, Enter opens it, and after עריכה and ביטול the row is back with the focus', async () => {
    const user = userEvent.setup()
    const fake = await open()
    const item = row('גבולות')
    // The check is the first control of the row (the title is not one), and the menu the second.
    const controls = within(item).getAllByRole('button')
    expect(controls[0]).toBe(within(item).getByRole('button', { name: t.markDoneNamed('גבולות') }))
    controls[0]?.focus()
    await user.tab()
    expect(within(item).getByRole('button', { name: t.actionsNamed('גבולות') })).toHaveFocus()
    await user.keyboard('{Enter}')
    const edit = await screen.findByRole('menuitem', { name: t.edit })
    await waitFor(() => {
      expect(edit).toHaveFocus()
    })
    await user.keyboard('{Enter}')
    const form = await screen.findByRole('form', { name: t.formLabel('גבולות') })
    // The form opens with the keyboard in its first field.
    await waitFor(() => {
      expect(within(form).getByRole('textbox', { name: t.title })).toHaveFocus()
    })
    within(form).getByRole('button', { name: en.common.cancel }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: t.formLabel('גבולות') })).not.toBeInTheDocument()
    })
    // The row is back, and the keyboard is on its menu, not at the top of the page.
    const actions = within(row('גבולות')).getByRole('button', { name: t.actionsNamed('גבולות') })
    await waitFor(() => {
      expect(actions).toHaveFocus()
    })
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('menuitem', { name: t.delete })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(row('גבולות')).getByRole('button', { name: t.actionsNamed('גבולות') })).toHaveFocus()
    })
    await user.tab({ shift: true })
    expect(within(row('גבולות')).getByRole('button', { name: t.markDoneNamed('גבולות') })).toHaveFocus()
    expect(fake.calls('PATCH')).toHaveLength(0)
  })

  it('the check is disabled while the update of its task is on its way, so a second press sends nothing', async () => {
    const user = userEvent.setup()
    let release: (value: TaskWriteResponse) => void = () => undefined
    const fake = server().on('PATCH /tasks/t1', () => new Promise<TaskWriteResponse>((resolve) => (release = resolve)))
    await open(fake)
    const check = () => within(row('גבולות')).getByRole('button', { name: t.markDoneNamed('גבולות') })
    await user.click(check())
    await waitFor(() => {
      expect(check()).toBeDisabled()
    })
    await user.click(check())
    release(written())
    await waitFor(() => {
      expect(check()).toBeEnabled()
    })
    expect(fake.calls('PATCH', '/tasks/t1')).toHaveLength(1)
  })

  it('shows the shape of the list while loading, and an empty state when there is nothing', async () => {
    openRoute(examServer({ tasks: [], topics: topicsFixture({ topics: [] }) }), '/exams/e1')
    expect(await screen.findByText(tp.empty)).toBeInTheDocument()
    expect(screen.getByText(tp.emptyHint)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: tp.title })).toBeInTheDocument()
  })

  it('a failed load of the tasks is an error state with retry', async () => {
    const user = userEvent.setup()
    let fail = true
    const fake = server().on({ method: 'GET', path: /^\/exams\/e1\/tasks$/ }, () => (fail ? problem(500, 'internal_error') : TASKS))
    openRoute(fake, '/exams/e1')
    // The analysis section reads the same tasks and has a retry of its own: this is the one of the list.
    const section = await screen.findByRole('region', { name: tp.title })
    const retry = await within(section).findByRole('button', { name: en.common.retry })
    expect(within(section).getByRole('alert')).toHaveTextContent(en.codes.internal_error)
    fail = false
    await user.click(retry)
    expect(await within(section).findByText('גבולות')).toBeInTheDocument()
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
    await choose(user, 'שאלות של המתרגל', t.delete)
    await waitFor(() => {
      expect(fake.calls('DELETE', '/tasks/t3')).toHaveLength(1)
    })
    const toast = await screen.findByRole('region', { name: en.common.notifications })
    await within(toast).findByText(t.deleted)
    await waitFor(() => {
      expect(screen.queryByText('שאלות של המתרגל')).not.toBeInTheDocument()
    })
    await user.click(within(toast).getByRole('button', { name: en.common.undo }))
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
    await choose(user, 'שאלות של המתרגל', t.delete)
    await waitFor(() => {
      expect(topicCalls()).toBeGreaterThan(initial)
    })
    const afterWrite = topicCalls()
    const toast = await screen.findByRole('region', { name: en.common.notifications })
    await user.click(await within(toast).findByRole('button', { name: en.common.undo }))
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
    expect(await screen.findByText(en.codes.not_found)).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: en.common.save }))
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
    await chooseTopic(user, 'נגזרות')
    await user.click(screen.getByRole('button', { name: t.add }))
    await waitFor(() => {
      expect(fake.calls('POST', '/tasks').map((c) => c.body)).toEqual([
        { exam_id: 'e1', title: 'חזרה על תרגיל 4', estimated_minutes: 45, kind: 'custom', topic_id: 'p2' },
      ])
    })
    const toast = await screen.findByRole('region', { name: en.common.notifications })
    await within(toast).findByText(t.addedPlaced)
    expect(within(toast).getByRole('button', { name: en.common.undo })).toBeInTheDocument()
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
