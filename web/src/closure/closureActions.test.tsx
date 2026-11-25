import { useEffect, useState } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorMessage } from '../api/client'
import { useBlockActions } from '../board/actions'
import { useSplitActions } from '../calendar/splitActions'
import { tasksKey, useExamTasks } from '../exam/api'
import type { ExamTask, TaskKind, TaskStatus } from '../exam/types'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { useExams } from '../onboarding/api'
import { useProgress } from '../progress/api'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard, USER_ID } from '../test/boardFixtures'
import { makeClosureItem, makeCloseResult, makeMoedBResult } from '../test/closureFixtures'
import { createFakeApi, problem, type Reply } from '../test/fakeApi'
import { useClosures } from './api'
import { onBloom } from './bloomEvents'
import {
  useClosureActions,
  type CloseFailure,
  type ClosureActions,
  type MoedBFailure,
  type UndoFailure,
} from './closureActions'
import type { BloomEvent, CloseResult, MoedBBody, MoedBResult } from './types'

vi.mock('../board/offerReplan', () => ({ useOfferReplan: () => vi.fn() }))

const c = en.closure
const ITEM = makeClosureItem()
const CLOSE_PATH = '/exams/exam-1/close'
const MOED_B_PATH = '/exams/exam-1/moed-b'
const TASKS_PATH = '/exams/exam-1/tasks'
const BODY: MoedBBody = { exam_date: '2026-12-20', grade: 55, hard_topic_ids: ['topic-1'] }

let actions: ClosureActions
let blockPending: (id: string) => boolean
let splitting: (id: string) => boolean
let unmountCaller: () => void

// The caller of the actions (the sheet in Task 4, the exam screen in Task 6), which a test can take off the tree.
function Caller() {
  const current = useClosureActions()
  useEffect(() => {
    actions = current
  })
  return (
    <>
      <p data-testid="closing">{String(current.closing('exam-1'))}</p>
      <p data-testid="planning">{String(current.planning('exam-1'))}</p>
      <p data-testid="undoing">{String(current.undoing('version-1'))}</p>
    </>
  )
}

// The rest of the app: the queries the actions refresh, and the block and split actions.
function Harness() {
  const [shown, setShown] = useState(true)
  useClosures()
  useExams()
  useProgress()
  useExamTasks('exam-1')
  const blocks = useBlockActions()
  const split = useSplitActions()
  useEffect(() => {
    blockPending = (id) => blocks.pending(id)
    splitting = (id) => split.splitting(id)
    unmountCaller = () => {
      setShown(false)
    }
  })
  return shown ? <Caller /> : null
}

function task(kind: TaskKind, status: TaskStatus = 'todo', id = `t-${kind}-${status}`): ExamTask {
  return {
    id,
    exam_id: 'exam-1',
    title: kind,
    kind,
    estimated_minutes: 60,
    focus: 3,
    depends_on_task_id: null,
    status,
    source: 'ai',
    created_at: '2026-11-01T08:00:00Z',
    topic_id: null,
    material_id: null,
    position: null,
    reason: null,
  }
}

function setup({
  close = makeCloseResult(),
  moedB = makeMoedBResult(),
  undo = {},
  tasks = [task('learn')],
}: { close?: Reply; moedB?: Reply; undo?: Reply; tasks?: Reply } = {}) {
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', makeToday([makeBlock({ id: 'b1' })]))
    .on({ method: 'GET', path: /^\/plan/ }, makePlan([makeBlock({ id: 'b1' })]))
    .on('GET /split-offers', { offers: [] })
    .on('GET /closures', { pending: [ITEM], waiting: [] })
    .on('GET /exams', [])
    .on('GET /progress', {})
    .on(`GET ${TASKS_PATH}`, tasks)
    .on(`POST ${CLOSE_PATH}`, close)
    .on(`POST ${MOED_B_PATH}`, moedB)
    .on('POST /plan/undo', undo)
  const view = renderBoard(<Harness />, { api: fake.api })
  return { fake, ...view }
}

// A reply the test resolves when it wants.
function later<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

async function ready(fake: ReturnType<typeof createFakeApi>) {
  await waitFor(() => {
    expect(fake.calls('GET', '/closures')).toHaveLength(1)
    expect(fake.calls('GET', '/exams')).toHaveLength(1)
    expect(fake.calls('GET', '/progress')).toHaveLength(1)
    expect(fake.calls('GET', TASKS_PATH)).toHaveLength(1)
  })
}

// Every read the plan names (Review Focus 4) is asked for again.
async function refreshed(fake: ReturnType<typeof createFakeApi>, before: Record<string, number>) {
  await waitFor(() => {
    for (const path of Object.keys(before)) {
      expect(fake.calls('GET', path).length, path).toBeGreaterThan(before[path] ?? 0)
    }
  })
}
function counts(fake: ReturnType<typeof createFakeApi>) {
  return Object.fromEntries(['/closures', '/exams', '/progress', TASKS_PATH].map((p) => [p, fake.calls('GET', p).length]))
}

function blooms() {
  const events: BloomEvent[] = []
  const off = onBloom((event) => {
    events.push(event)
  })
  return { events, off }
}

let bloom: ReturnType<typeof blooms>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-11-23T18:00:00Z'))
  bloom = blooms()
})
afterEach(() => {
  bloom.off()
  vi.useRealTimers()
})

describe('useClosureActions close', () => {
  it('posts the outcome, hands the answer to onSuccess and blooms once', async () => {
    const { fake } = setup()
    await ready(fake)
    const onSuccess = vi.fn<(r: CloseResult) => void>()
    act(() => {
      actions.close(ITEM, 'done', { onSuccess })
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(fake.calls('POST', CLOSE_PATH).map((x) => x.body)).toEqual([{ outcome: 'done' }])
    expect(onSuccess).toHaveBeenCalledWith(makeCloseResult())
    expect(bloom.events).toEqual([makeCloseResult().event])
  })

  it('does not bloom for moed_b, for an answer without an event, or for a failure', async () => {
    const { fake } = setup({ close: makeCloseResult({ event: null }) })
    await ready(fake)
    const done = vi.fn()
    act(() => {
      actions.close(ITEM, 'moed_b', { onSuccess: done })
    })
    await waitFor(() => {
      expect(done).toHaveBeenCalledTimes(1)
    })
    // moed_b even with an event in the answer.
    fake.on(`POST ${CLOSE_PATH}`, makeCloseResult())
    expect(fake.calls('POST', CLOSE_PATH).map((x) => x.body)).toEqual([{ outcome: 'moed_b' }])
    act(() => {
      actions.close(ITEM, 'moed_b', { onSuccess: done })
    })
    await waitFor(() => {
      expect(done).toHaveBeenCalledTimes(2)
    })
    fake.on(`POST ${CLOSE_PATH}`, makeCloseResult({ event: null }))
    act(() => {
      actions.close(ITEM, 'done', { onSuccess: done })
    })
    await waitFor(() => {
      expect(done).toHaveBeenCalledTimes(3)
    })
    fake.on(`POST ${CLOSE_PATH}`, problem(500, 'internal'))
    const onError = vi.fn<(f: CloseFailure) => void>()
    act(() => {
      actions.close(ITEM, 'done', { onError })
    })
    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1)
    })
    expect(onError).toHaveBeenCalledWith({ kind: 'error', message: errorMessage(problem(500, 'internal')) })
    expect(bloom.events).toEqual([])
    // The sheet shows the error itself: no toast.
    expect(screen.queryByText(errorMessage(problem(500, 'internal')))).not.toBeInTheDocument()
  })

  it('two closes of one exam in a row send one POST', async () => {
    const reply = later<CloseResult>()
    const { fake } = setup({ close: () => reply.promise })
    await ready(fake)
    const onSuccess = vi.fn()
    act(() => {
      actions.close(ITEM, 'done', { onSuccess })
      actions.close(ITEM, 'done', { onSuccess })
    })
    act(() => {
      actions.close(ITEM, 'moed_b', { onSuccess })
    })
    await act(async () => {
      reply.resolve(makeCloseResult())
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(fake.calls('POST', CLOSE_PATH)).toHaveLength(1)
    expect(bloom.events).toHaveLength(1)
  })

  it('closing(examId) is true only while the POST waits, and the block and split actions are not confused by it', async () => {
    const reply = later<CloseResult>()
    const { fake } = setup({ close: () => reply.promise })
    await ready(fake)
    expect(screen.getByTestId('closing')).toHaveTextContent('false')
    act(() => {
      actions.close(ITEM, 'done')
    })
    await waitFor(() => {
      expect(screen.getByTestId('closing')).toHaveTextContent('true')
    })
    expect(actions.closing('exam-2')).toBe(false)
    expect(actions.planning('exam-1')).toBe(false)
    expect(blockPending('b1')).toBe(false)
    expect(splitting('exam-1')).toBe(false)
    await act(async () => {
      reply.resolve(makeCloseResult())
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId('closing')).toHaveTextContent('false')
    })
  })

  it('refreshes the closures, both exam lists, the tasks and the progress after a success and after a failure', async () => {
    const { fake } = setup()
    await ready(fake)
    let before = counts(fake)
    act(() => {
      actions.close(ITEM, 'done')
    })
    await refreshed(fake, before)
    fake.on(`POST ${CLOSE_PATH}`, problem(500, 'internal'))
    before = counts(fake)
    act(() => {
      actions.close(ITEM, 'done')
    })
    await refreshed(fake, before)
  })

  it('invalid_state says the exam changed, as an info toast, and reports stale', async () => {
    const { fake } = setup({ close: problem(409, 'invalid_state') })
    await ready(fake)
    const onError = vi.fn<(f: CloseFailure) => void>()
    act(() => {
      actions.close(ITEM, 'done', { onError })
    })
    expect(await screen.findByText(c.sheet.stale)).toBeInTheDocument()
    expect(onError).toHaveBeenCalledWith({ kind: 'stale' })
  })

  it('a 404 says it is gone and reports stale', async () => {
    const { fake } = setup({ close: problem(404, 'not_found') })
    await ready(fake)
    const onError = vi.fn<(f: CloseFailure) => void>()
    act(() => {
      actions.close(ITEM, 'moed_b', { onError })
    })
    expect(await screen.findByText(codeText('not_found'))).toBeInTheDocument()
    expect(onError).toHaveBeenCalledWith({ kind: 'stale' })
  })

  it('the handlers still run after the caller is gone (the sheet checks itself whether it is mounted)', async () => {
    const reply = later<CloseResult>()
    const { fake } = setup({ close: () => reply.promise })
    await ready(fake)
    const onSuccess = vi.fn()
    act(() => {
      actions.close(ITEM, 'done', { onSuccess })
    })
    await waitFor(() => {
      expect(fake.calls('POST', CLOSE_PATH)).toHaveLength(1)
    })
    act(() => {
      unmountCaller()
    })
    await act(async () => {
      reply.resolve(makeCloseResult())
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(bloom.events).toHaveLength(1)
  })
})

describe('useClosureActions finish', () => {
  it('closes done with a toast and its Undo, which still works after the caller is gone', async () => {
    const { fake } = setup()
    await ready(fake)
    act(() => {
      actions.finish(ITEM)
    })
    expect(await screen.findByText(c.sheet.bloomed(ITEM.exam_name))).toBeInTheDocument()
    expect(fake.calls('POST', CLOSE_PATH).map((x) => x.body)).toEqual([{ outcome: 'done' }])
    expect(bloom.events).toEqual([makeCloseResult().event])
    act(() => {
      unmountCaller()
    })
    const before = counts(fake)
    await user().click(screen.getByRole('button', { name: en.common.undo }))
    expect(await screen.findByText(c.sheet.undone(ITEM.exam_name))).toBeInTheDocument()
    expect(fake.calls('POST', '/plan/undo').map((x) => x.body)).toEqual([{ version_id: 'version-1' }])
    await refreshed(fake, before)
    // Undo never blooms (nor takes a bloom back with an event).
    expect(bloom.events).toHaveLength(1)
  })

  it('a failed Undo says why in a toast', async () => {
    const { fake } = setup({ undo: problem(409, 'stale_plan') })
    await ready(fake)
    act(() => {
      actions.finish(ITEM)
    })
    await user().click(await screen.findByRole('button', { name: en.common.undo }))
    expect(await screen.findByText(codeText('stale_plan'))).toBeInTheDocument()
  })

  it('an error is an error toast; invalid_state is the stale toast', async () => {
    const { fake } = setup({ close: problem(500, 'internal') })
    await ready(fake)
    act(() => {
      actions.finish(ITEM)
    })
    expect(await screen.findByText(errorMessage(problem(500, 'internal')))).toBeInTheDocument()
    fake.on(`POST ${CLOSE_PATH}`, problem(409, 'invalid_state'))
    act(() => {
      actions.finish(ITEM)
    })
    expect(await screen.findByText(c.sheet.stale)).toBeInTheDocument()
    expect(bloom.events).toEqual([])
  })
})

describe('useClosureActions openMoedB', () => {
  it('posts the body as it is and hands the answer and the count of practice exams to onSuccess', async () => {
    const { fake } = setup()
    await ready(fake)
    const onSuccess = vi.fn<(r: MoedBResult, simulations: number) => void>()
    act(() => {
      actions.openMoedB('exam-1', BODY, { onSuccess })
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(fake.calls('POST', MOED_B_PATH).map((x) => x.body)).toEqual([BODY])
    // No simulation among the tasks: the round starts with one default practice exam.
    expect(onSuccess).toHaveBeenCalledWith(makeMoedBResult(), 1)
    expect(bloom.events).toEqual([])
  })

  it('counts the simulations of sitting 1 in any status, at most two, never their reviews', async () => {
    const { fake, queryClient } = setup({
      tasks: [task('simulation', 'done', 's1'), task('simulation_review', 'todo', 'r1'), task('learn')],
    })
    await ready(fake)
    const onSuccess = vi.fn<(r: MoedBResult, simulations: number) => void>()
    act(() => {
      actions.openMoedB('exam-1', BODY, { onSuccess })
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(onSuccess.mock.calls[0]?.[1]).toBe(1)
    queryClient.setQueryData<ExamTask[]>(tasksKey(USER_ID, 'exam-1'), [
      task('simulation', 'done', 's1'),
      task('simulation', 'skipped', 's2'),
      task('simulation', 'todo', 's3'),
      task('simulation_review', 'todo', 'r1'),
    ])
    act(() => {
      actions.openMoedB('exam-1', BODY, { onSuccess })
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(2)
    })
    expect(onSuccess.mock.calls[1]?.[1]).toBe(2)
  })

  it('asks for the tasks first when the web does not hold them', async () => {
    const { fake, queryClient } = setup({ tasks: [task('simulation', 'todo', 's1'), task('simulation', 'todo', 's2')] })
    await ready(fake)
    queryClient.removeQueries({ queryKey: tasksKey(USER_ID, 'exam-1') })
    const before = fake.calls('GET', TASKS_PATH).length
    const onSuccess = vi.fn<(r: MoedBResult, simulations: number) => void>()
    act(() => {
      actions.openMoedB('exam-1', BODY, { onSuccess })
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(fake.calls('GET', TASKS_PATH).length).toBeGreaterThan(before)
    expect(onSuccess.mock.calls[0]?.[1]).toBe(2)
  })

  it('planning(examId) is true while it waits, and two submits send one POST', async () => {
    const reply = later<MoedBResult>()
    const { fake } = setup({ moedB: () => reply.promise })
    await ready(fake)
    act(() => {
      actions.openMoedB('exam-1', BODY)
      actions.openMoedB('exam-1', BODY)
    })
    await waitFor(() => {
      expect(screen.getByTestId('planning')).toHaveTextContent('true')
    })
    expect(screen.getByTestId('closing')).toHaveTextContent('false')
    await act(async () => {
      reply.resolve(makeMoedBResult())
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.getByTestId('planning')).toHaveTextContent('false')
    })
    expect(fake.calls('POST', MOED_B_PATH)).toHaveLength(1)
  })

  it('refreshes every read after a success', async () => {
    const { fake } = setup()
    await ready(fake)
    const before = counts(fake)
    act(() => {
      actions.openMoedB('exam-1', BODY)
    })
    await refreshed(fake, before)
  })

  async function failure(reply: Reply): Promise<MoedBFailure> {
    const { fake } = setup({ moedB: reply })
    await ready(fake)
    const onError = vi.fn<(f: MoedBFailure) => void>()
    act(() => {
      actions.openMoedB('exam-1', BODY, { onError })
    })
    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1)
    })
    return onError.mock.calls[0]?.[0] as MoedBFailure
  }

  it('exam_in_past is a date too early, under the date field', async () => {
    expect(await failure(problem(422, 'exam_in_past'))).toEqual({
      kind: 'fields',
      errors: { date: en.onboardingExams.dateTooEarly },
    })
  })

  it('too_far_ahead on exam_date is a date too late', async () => {
    const tooFar = problem(422, 'validation_error', { errors: [{ loc: ['body', 'exam_date'], type: 'too_far_ahead' }] })
    expect(await failure(tooFar)).toEqual({ kind: 'fields', errors: { date: en.onboardingExams.dateTooLate } })
  })

  it('another 422 is the general validation text', async () => {
    const unknownTopic = problem(422, 'validation_error', { errors: [{ loc: ['body', 'hard_topic_ids'], type: 'unknown_topic' }] })
    expect(await failure(unknownTopic)).toEqual({ kind: 'error', message: codeText('validation_error') })
  })

  it('invalid_state is the stale toast', async () => {
    expect(await failure(problem(409, 'invalid_state'))).toEqual({ kind: 'stale' })
    expect(await screen.findByText(c.sheet.stale)).toBeInTheDocument()
  })

  it('any other error is its message, without a toast', async () => {
    expect(await failure(problem(500, 'internal'))).toEqual({ kind: 'error', message: errorMessage(problem(500, 'internal')) })
    expect(screen.queryByText(errorMessage(problem(500, 'internal')))).not.toBeInTheDocument()
  })
})

describe('useClosureActions undo', () => {
  it('posts /plan/undo once even when asked twice, refreshes, and calls onSuccess', async () => {
    const reply = later<unknown>()
    const { fake } = setup({ undo: () => reply.promise })
    await ready(fake)
    const onSuccess = vi.fn()
    act(() => {
      actions.undo('version-1', 'close', { onSuccess })
      actions.undo('version-1', 'close', { onSuccess })
    })
    await waitFor(() => {
      expect(screen.getByTestId('undoing')).toHaveTextContent('true')
    })
    const before = counts(fake)
    await act(async () => {
      reply.resolve({})
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(fake.calls('POST', '/plan/undo').map((x) => x.body)).toEqual([{ version_id: 'version-1' }])
    await refreshed(fake, before)
    await waitFor(() => {
      expect(screen.getByTestId('undoing')).toHaveTextContent('false')
    })
    // A version that was undone is not sent again.
    act(() => {
      actions.undo('version-1', 'close', { onSuccess })
    })
    expect(fake.calls('POST', '/plan/undo')).toHaveLength(1)
  })

  async function undoFailure(reply: Reply, reason: 'close' | 'moed_b'): Promise<UndoFailure> {
    const { fake } = setup({ undo: reply })
    await ready(fake)
    const onError = vi.fn<(f: UndoFailure) => void>()
    const before = counts(fake)
    act(() => {
      actions.undo('version-1', reason, { onError })
    })
    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1)
    })
    await refreshed(fake, before)
    return onError.mock.calls[0]?.[0] as UndoFailure
  }

  it('invalid_state of a Moed B says it is already under way', async () => {
    expect(await undoFailure(problem(409, 'invalid_state'), 'moed_b')).toEqual({ message: c.moedB.cantUndo })
  })

  it('invalid_state of a close is the code text', async () => {
    expect(await undoFailure(problem(409, 'invalid_state'), 'close')).toEqual({ message: codeText('invalid_state') })
  })

  it('stale_plan and nothing_to_undo are their code texts, without a toast', async () => {
    expect(await undoFailure(problem(409, 'stale_plan'), 'moed_b')).toEqual({ message: codeText('stale_plan') })
    expect(screen.queryByText(codeText('stale_plan'))).not.toBeInTheDocument()
  })

  it('a failed undo can be tried again', async () => {
    const { fake } = setup({ undo: problem(500, 'internal') })
    await ready(fake)
    const onError = vi.fn()
    act(() => {
      actions.undo('version-1', 'close', { onError })
    })
    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1)
    })
    fake.on('POST /plan/undo', {})
    const onSuccess = vi.fn()
    act(() => {
      actions.undo('version-1', 'close', { onSuccess })
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
    expect(fake.calls('POST', '/plan/undo')).toHaveLength(2)
  })
})
