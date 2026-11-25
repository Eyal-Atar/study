import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { durationText } from '../board/time'
import { en } from '../i18n/en'
import { makeProgress } from '../progress/testFixtures'
import { makeClosureItem, makeCloseResult, makeMoedBResult } from '../test/closureFixtures'
import { problem } from '../test/fakeApi'
import { examServer, openRoute, taskFixture } from '../test/examFixtures'
import type { Material } from '../onboarding/types'
import { examFixture } from '../test/onboardingFixtures'
import { dayMonth, longDate } from './dates'

vi.mock('../board/offerReplan', () => ({ useOfferReplan: () => vi.fn() }))

const c = en.closure
const t = en.exam

// The clock is frozen at noon UTC of this day in every test.
const NOW = new Date('2026-11-23T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) })

function later<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// The segments are day, month, year (en-GB).
async function typeDate(u: UserEvent, iso: string) {
  const [year, month, day] = iso.split('-')
  const group = screen.getByRole('group', { name: c.moedB.date })
  const [first] = within(group).getAllByRole('spinbutton')
  if (first === undefined) throw new Error('no date segments')
  await u.click(first)
  await u.keyboard(`${String(day)}${String(month)}${String(year)}`)
}

const ACTIVE = examFixture({ id: 'a1', name: 'חדו"א', exam_date: '2026-11-30', color_index: 1 })
const PENDING = examFixture({ id: 'p1', name: 'הסתברות', exam_date: '2026-11-23', color_index: 2, state: 'pending' })
const WAITING = examFixture({ id: 'w1', name: 'אלגוריתמים', exam_date: '2026-11-16', color_index: 3, state: 'waiting_moed_b' })
const OLD_DONE = examFixture({
  id: 'd1',
  name: 'פיזיקה',
  exam_date: '2026-11-02',
  color_index: 4,
  state: 'done',
  closed_at: '2026-11-10T10:00:00Z',
})
const NEW_DONE = examFixture({
  id: 'd2',
  name: 'לוגיקה',
  exam_date: '2026-11-18',
  color_index: 5,
  state: 'done',
  closed_at: '2026-11-20T10:00:00Z',
})

function archived(exam: typeof NEW_DONE) {
  return {
    exam_id: exam.id,
    name: exam.name,
    color_index: exam.color_index,
    exam_date: exam.exam_date,
    first_exam_date: null,
    sitting: 1,
    closed_at: exam.closed_at ?? null,
    studied_minutes: 1260,
    tasks_done: 14,
    tasks_total: 17,
    completion_percent: 86,
  }
}

// The server of the closure screens: the exams, what GET /closures says about them, and the archive.
function setup(exams = [PENDING], { closures = {}, archive = [] as ReturnType<typeof archived>[] } = {}) {
  const fake = examServer({ exams })
  fake.on('GET /closures', {
    pending: exams.filter((e) => e.state === 'pending').map((e) => makeClosureItem({ exam_id: e.id, exam_name: e.name, color_index: e.color_index })),
    waiting: exams
      .filter((e) => e.state === 'waiting_moed_b')
      .map((e) => makeClosureItem({ exam_id: e.id, exam_name: e.name, color_index: e.color_index, state: 'waiting_moed_b', tasks_total: 17 })),
    ...closures,
  })
  fake.on('GET /progress', makeProgress({ archive }))
  return fake
}

function material(id: string): Material {
  return {
    id,
    exam_id: 'w1',
    filename: `${id}.pdf`,
    kind: 'notes',
    mime: 'application/pdf',
    size_bytes: 1000,
    page_count: 3,
    scanned_pages: null,
    ingest_status: 'ready',
    ingest_error: null,
    warnings: [],
    created_at: '2026-11-16T08:00:00Z',
    ingested_at: '2026-11-16T08:01:00Z',
  }
}

describe('the exams list with closures', () => {
  it('keeps three current exams on the card and the closed ones, last closed first, under Archive', async () => {
    const fake = setup([ACTIVE, PENDING, WAITING, OLD_DONE, NEW_DONE])
    fake.on({ method: 'GET', path: /^\/exams\/d2\/tasks$/ }, [taskFixture({ exam_id: 'd2', status: 'done', estimated_minutes: 60 })])
    openRoute(fake, '/exams')
    const current = await screen.findByRole('list', { name: t.list.listTitle })
    const rows = within(current).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    // By date: Moed A of the waiting exam, the pending one, the active one.
    expect(rows[0]).toHaveTextContent(c.list.waiting)
    expect(rows[1]).toHaveTextContent(c.list.pending)
    expect(rows[2]).toHaveTextContent(en.exams.list.chip(7))
    expect(screen.getByText(t.list.count(3))).toBeInTheDocument()

    expect(screen.getByRole('heading', { level: 2, name: c.list.archive })).toBeInTheDocument()
    const archive = screen.getByRole('list', { name: c.list.archive })
    const archivedRows = within(archive).getAllByRole('listitem')
    expect(archivedRows).toHaveLength(2)
    expect(archivedRows[0]).toHaveTextContent('לוגיקה')
    expect(archivedRows[1]).toHaveTextContent('פיזיקה')
    expect(archivedRows[0]).toHaveTextContent(c.list.done)
    expect(within(archive).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['/exams/d2', '/exams/d1'])
    // The date of the closure, then the progress of the plan once its tasks are known.
    await waitFor(() => {
      expect(archivedRows[0]).toHaveTextContent(c.list.closedOn(dayMonth('2026-11-20'), en.exams.list.progress(100)))
    })
  })

  it('shows the closure date with the progress of an archived exam', async () => {
    const fake = setup([NEW_DONE])
    fake.on({ method: 'GET', path: /^\/exams\/d2\/tasks$/ }, [
      taskFixture({ exam_id: 'd2', status: 'done', estimated_minutes: 86 }),
      taskFixture({ id: 't2', exam_id: 'd2', status: 'todo', estimated_minutes: 14 }),
    ])
    openRoute(fake, '/exams')
    const archive = await screen.findByRole('list', { name: c.list.archive })
    await waitFor(() => {
      expect(archive).toHaveTextContent(c.list.closedOn(dayMonth('2026-11-20'), en.exams.list.progress(86)))
    })
  })

  it('an archived exam without tasks shows the closure date alone, not "No tasks yet"', async () => {
    const fake = setup([NEW_DONE])
    openRoute(fake, '/exams')
    const archive = await screen.findByRole('list', { name: c.list.archive })
    await waitFor(() => {
      expect(fake.calls('GET', '/exams/d2/tasks')).toHaveLength(1)
    })
    const [row] = within(archive).getAllByRole('listitem')
    await waitFor(() => {
      expect(within(row as HTMLElement).getByText(c.progress.closedOn(dayMonth('2026-11-20')))).toBeInTheDocument()
    })
    expect(archive).not.toHaveTextContent(en.exams.list.noTasks)
  })

  it('with only closed exams says none are coming, keeps Archive, and does not show the empty screen', async () => {
    const fake = setup([OLD_DONE])
    openRoute(fake, '/exams')
    expect(await screen.findByText(c.list.noneComing)).toHaveClass('text-body', 'text-ink-muted')
    expect(screen.getByRole('heading', { level: 2, name: c.list.archive })).toBeInTheDocument()
    expect(screen.queryByText(t.list.empty)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: t.list.listTitle })).not.toBeInTheDocument()
    // No current exam: no count.
    expect(screen.queryByText(/^\d+ exams?$/)).not.toBeInTheDocument()
  })

  it('says Moed B first in the detail of an exam in its second sitting', async () => {
    const fake = setup([examFixture({ id: 'b1', exam_date: '2026-12-20', sitting: 2, first_exam_date: '2026-11-16', first_grade: 55 })])
    openRoute(fake, '/exams')
    const list = await screen.findByRole('list', { name: t.list.listTitle })
    await waitFor(() => {
      expect(list).toHaveTextContent(`Moed B. ${longDate('2026-12-20')}`)
    })
  })
})

describe('the exam screen by closure state', () => {
  it('shows Moed A in the header of Moed B', async () => {
    const fake = setup([examFixture({ id: 'b1', exam_date: '2026-12-20', sitting: 2, first_exam_date: '2026-11-16', first_grade: 55 })])
    openRoute(fake, '/exams/b1')
    expect(await screen.findByText(c.exam.moedALine(longDate('2026-11-16'), 55))).toBeInTheDocument()
    expect(c.exam.moedALine('16 November 2026', 55)).toBe('Moed A was on 16 November 2026, grade 55.')
  })

  it('pending: the card opens the sheet, and no control of a live exam is left', async () => {
    const fake = setup([PENDING])
    openRoute(fake, '/exams/p1')
    expect(await screen.findByRole('heading', { level: 1, name: 'הסתברות' })).toBeInTheDocument()
    expect(screen.getByText(c.sheet.title('הסתברות'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.header.editLabel })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.tasks.add })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Done:/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /analy/i })).not.toBeInTheDocument()
    expect(fake.calls('GET', /^\/plan/)).toHaveLength(0)
    await user().click(screen.getByRole('button', { name: c.card.open }))
    expect(await screen.findByRole('dialog', { name: c.sheet.title('הסתברות') })).toBeInTheDocument()
  })

  it('waiting for Moed B: what is kept, Plan Moed B, and I’m done with it; no edit and no plan request', async () => {
    const fake = setup([WAITING])
    fake.on({ method: 'GET', path: /^\/exams\/w1\/materials$/ }, [
      material('m1'),
      material('m2'),
    ])
    fake.on('POST /exams/w1/close', makeCloseResult({ version_id: 'v9' }))
    fake.on('POST /plan/undo', {})
    openRoute(fake, '/exams/w1')
    expect(await screen.findByText(c.waiting.say('אלגוריתמים'))).toBeInTheDocument()
    expect(await screen.findByText(c.waiting.kept(2, 17))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.header.editLabel })).not.toBeInTheDocument()
    expect(fake.calls('GET', /^\/plan/)).toHaveLength(0)

    const u = user()
    await u.click(screen.getByRole('button', { name: c.waiting.plan }))
    expect(await screen.findByRole('dialog', { name: c.moedB.title })).toBeInTheDocument()
    await u.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    await u.click(screen.getByRole('button', { name: c.waiting.done }))
    expect(await screen.findByText(c.sheet.bloomed('אלגוריתמים'))).toBeInTheDocument()
    expect(fake.calls('POST', '/exams/w1/close').map((x) => x.body)).toEqual([{ outcome: 'done' }])
    expect(screen.getByRole('button', { name: en.common.undo })).toBeInTheDocument()
  })

  it('done: the card of the archive with its summary, the bloom slot, and no control but the way back', async () => {
    const fake = setup([NEW_DONE], { archive: [archived(NEW_DONE)] })
    openRoute(fake, '/exams/d2')
    expect(await screen.findByText(c.archived.say('לוגיקה'))).toBeInTheDocument()
    expect(await screen.findByText(c.sheet.stats(durationText(1260), 86))).toBeInTheDocument()
    expect(screen.getByText(c.archived.closedOn(longDate('2026-11-20')))).toBeInTheDocument()
    expect(document.querySelector('[data-slot="bloom"]')).not.toBeNull()
    expect(within(screen.getByRole('main')).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('link', { name: t.backToList })).toBeInTheDocument()
    expect(fake.calls('GET', /^\/plan/)).toHaveLength(0)
  })

  it('a failed refresh of the exams keeps the screen, the Moed B sheet after planning and its Undo', async () => {
    const fake = setup([WAITING])
    fake.on('POST /exams/w1/moed-b', makeMoedBResult({ exam: { ...makeMoedBResult().exam, id: 'w1', name: 'אלגוריתמים' } }))
    openRoute(fake, '/exams/w1')
    const u = user()
    await u.click(await screen.findByRole('button', { name: c.waiting.plan }))
    await screen.findByRole('dialog', { name: c.moedB.title })
    await typeDate(u, '2026-12-20')
    // The refresh after the answer fails (a phone without a network).
    fake.on('GET /exams', problem(500, 'internal'))
    const before = fake.calls('GET', '/exams').length
    await u.click(screen.getByRole('button', { name: c.moedB.submit }))
    const done = await screen.findByRole('dialog', { name: c.moedB.done(1, ['התפלגות בינומית']) })
    await waitFor(() => {
      expect(fake.calls('GET', '/exams').length).toBeGreaterThan(before)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(within(done).getByRole('button', { name: en.common.undo })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: c.moedB.done(1, ['התפלגות בינומית']) })).toBe(done)
  })

  it('Plan Moed B waits while the exam is being closed', async () => {
    const fake = setup([WAITING])
    const reply = later<ReturnType<typeof makeCloseResult>>()
    fake.on('POST /exams/w1/close', () => reply.promise)
    openRoute(fake, '/exams/w1')
    const u = user()
    await u.click(await screen.findByRole('button', { name: c.waiting.done }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: c.waiting.plan })).toBeDisabled()
    })
    await act(async () => {
      reply.resolve(makeCloseResult({ version_id: 'v9' }))
      await Promise.resolve()
    })
  })

  it('after I’m done with it, the focus lands on the archive card, not on the page', async () => {
    const fake = setup([WAITING])
    fake.on('POST /exams/w1/close', () => {
      fake.on('GET /exams', [{ ...WAITING, state: 'done', closed_at: '2026-11-23T11:00:00Z' }])
      return makeCloseResult({ version_id: 'v9' })
    })
    openRoute(fake, '/exams/w1')
    const u = user()
    await u.click(await screen.findByRole('button', { name: c.waiting.done }))
    const say = await screen.findByText(c.archived.say('אלגוריתמים'))
    const card = say.closest('[tabindex="-1"]')
    expect(card).not.toBeNull()
    await waitFor(() => {
      expect(card).toHaveFocus()
    })
  })

  it('a failed background refresh of the closures keeps the card and its buttons', async () => {
    const fake = setup([WAITING])
    openRoute(fake, '/exams/w1')
    expect(await screen.findByRole('button', { name: c.waiting.plan })).toBeInTheDocument()
    fake.on('GET /closures', problem(500, 'internal'))
    const before = fake.calls('GET', '/closures').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 100)
    })
    await waitFor(() => {
      expect(fake.calls('GET', '/closures').length).toBeGreaterThan(before)
    })
    expect(screen.getByRole('button', { name: c.waiting.plan })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: c.waiting.done })).toBeInTheDocument()
  })

  it('an exam missing from the closures shows no endless loading', async () => {
    const fake = setup([WAITING], { closures: { waiting: [] } })
    openRoute(fake, '/exams/w1')
    expect(await screen.findByRole('heading', { level: 1, name: 'אלגוריתמים' })).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/closures').length).toBeGreaterThan(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(within(screen.getByRole('main')).queryByText(en.common.loading)).not.toBeInTheDocument()
  })

  it('says nothing of 0% on the evening of an exam with no study time and nothing done', async () => {
    const fake = setup([PENDING], {
      closures: { pending: [makeClosureItem({ exam_id: 'p1', studied_minutes: 0, tasks_done: 0, completion_percent: 0 })] },
    })
    openRoute(fake, '/exams/p1')
    expect(await screen.findByText(c.sheet.title('הסתברות'))).toBeInTheDocument()
    expect(screen.queryByText(c.sheet.statsNoTime(0))).not.toBeInTheDocument()
  })

  it('the card says Archi’s sentence once to a screen reader: no region named by the same sentence', async () => {
    const fake = setup([PENDING])
    openRoute(fake, '/exams/p1')
    expect(await screen.findByText(c.sheet.title('הסתברות'))).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: c.sheet.title('הסתברות') })).not.toBeInTheDocument()
  })
})
