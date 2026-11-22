import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeApi } from '../test/fakeApi'
import { useBlockActions } from '../board/actions'
import { makeBlock, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { useExamProgress } from './examProgress'
import { useCalendarData } from './useCalendarData'
import { makeBusy } from './testFixtures'
import { useExamTasks } from '../exam/api'

function Progress() {
  const map = useExamProgress(['exam-1'])
  const p = map.get('exam-1')
  return <output data-testid="p">{p === undefined ? 'none' : `${String(p.done)}/${String(p.total)}`}</output>
}

function Both() {
  const tasks = useExamTasks('exam-1')
  return <output data-testid="t">{tasks.data?.length ?? 'none'}</output>
}

function Data({ date }: { date: string | null }) {
  const data = useCalendarData(date)
  return <output data-testid="d">{JSON.stringify({ busy: data.busy.length, days: data.days.length, anchor: data.anchor ?? null })}</output>
}

const task = (over: object) => ({
  id: 't', exam_id: 'exam-1', title: 'T', kind: 'learn', estimated_minutes: 30, focus: 3, depends_on_task_id: null,
  status: 'todo', source: 'user', created_at: '2026-11-01T00:00:00Z', topic_id: null, material_id: null, position: null, reason: null, ...over,
})

describe('useExamProgress', () => {
  it('counts done minutes of done plus todo, and leaves skipped out', async () => {
    const fake = createFakeApi().on('GET /exams/exam-1/tasks', [
      task({ id: 'a', estimated_minutes: 60, status: 'done' }),
      task({ id: 'b', estimated_minutes: 90, status: 'todo' }),
      task({ id: 'c', estimated_minutes: 30, status: 'skipped' }),
    ])
    renderBoard(<Progress />, { api: fake.api })
    await waitFor(() => { expect(screen.getByTestId('p').textContent).toBe('60/150') })
  })
  it('shares the cache of the exam screen: one request for both', async () => {
    const fake = createFakeApi().on('GET /exams/exam-1/tasks', [task({ status: 'done' })])
    renderBoard(
      <>
        <Progress />
        <Both />
      </>,
      { api: fake.api },
    )
    await waitFor(() => { expect(screen.getByTestId('p').textContent).toBe('30/30') })
    await waitFor(() => { expect(screen.getByTestId('t').textContent).toBe('1') })
    expect(fake.calls('GET', '/exams/exam-1/tasks')).toHaveLength(1)
  })
})

// S32 final review, M2: "Your exams" moves after a Done.
describe('useExamProgress after an action', () => {
  it('Done refetches the exam’s tasks', async () => {
    const block = makeBlock({ exam_id: 'exam-1' })
    let status = 'todo'
    const fake = createFakeApi()
      .on('GET /exams/exam-1/tasks', () => [task({ id: 'a', estimated_minutes: 60, status })])
      .on(`POST /blocks/${block.id}/complete`, () => {
        status = 'done'
        return { block: { ...block, status: 'done', state: 'done' }, task_status: 'done', xp_awarded: 0, xp_total: 0, level: 1 }
      })
    function Done() {
      const actions = useBlockActions()
      return (
        <button type="button" onClick={() => { actions.complete(block) }}>
          done
        </button>
      )
    }
    renderBoard(
      <>
        <Progress />
        <Done />
      </>,
      { api: fake.api },
    )
    await waitFor(() => { expect(screen.getByTestId('p').textContent).toBe('0/60') })
    await userEvent.click(screen.getByRole('button', { name: 'done' }))
    await waitFor(() => { expect(screen.getByTestId('p').textContent).toBe('60/60') })
  })
})

describe('useCalendarData', () => {
  const base = () => createFakeApi().on('GET /today', makeToday()).on('GET /me', {}).on('GET /progress', {}).on('GET /exams', [])
  it('treats a plan answer without busy as no busy time', async () => {
    const noBusy: Record<string, unknown> = { ...makePlan() }
    delete noBusy.busy
    const fake = base().on({ method: 'GET', path: /^\/plan/ }, noBusy)
    renderBoard(<Data date="2026-11-24" />, { api: fake.api })
    await waitFor(() => { expect(fake.calls('GET', /^\/plan/).length).toBeGreaterThan(0) })
    await waitFor(() => { expect(screen.getByTestId('d').textContent).toBe('{"busy":0,"days":7,"anchor":"2026-11-24"}') })
  })
  it('takes the busy time of the plan of the week from the Sunday to the Saturday', async () => {
    const fake = base().on({ method: 'GET', path: /^\/plan/ }, makePlan([], { busy: [makeBusy()] }))
    renderBoard(<Data date="2026-11-24" />, { api: fake.api })
    await waitFor(() => { expect(screen.getByTestId('d').textContent).toContain('"busy":1') })
    expect(fake.calls('GET', '/plan?from=2026-11-22&to=2026-11-28')).toHaveLength(1)
  })
  it('anchors on the date of /today without a date', async () => {
    const fake = base().on({ method: 'GET', path: /^\/plan/ }, makePlan())
    renderBoard(<Data date={null} />, { api: fake.api })
    await waitFor(() => { expect(screen.getByTestId('d').textContent).toContain('"anchor":"2026-11-16"') })
  })
})
