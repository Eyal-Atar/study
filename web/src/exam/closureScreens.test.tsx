import { focusManager } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { durationText } from '../board/time'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { makeProgress } from '../progress/testFixtures'
import { makeClosureItem, makeCloseResult, makeDeleteResult, makeMoedBResult } from '../test/closureFixtures'
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

  it('says Retake first in the detail of an exam in its second sitting', async () => {
    const fake = setup([examFixture({ id: 'b1', exam_date: '2026-12-20', sitting: 2, first_exam_date: '2026-11-16', first_grade: 55 })])
    openRoute(fake, '/exams')
    const list = await screen.findByRole('list', { name: t.list.listTitle })
    await waitFor(() => {
      expect(list).toHaveTextContent(`Retake. ${longDate('2026-12-20')}`)
    })
  })
})

describe('the exam screen by closure state', () => {
  it('shows the first sitting in the header of a retake', async () => {
    const fake = setup([examFixture({ id: 'b1', exam_date: '2026-12-20', sitting: 2, first_exam_date: '2026-11-16', first_grade: 55 })])
    openRoute(fake, '/exams/b1')
    expect(await screen.findByText(c.exam.moedALine(longDate('2026-11-16'), 55))).toBeInTheDocument()
    expect(c.exam.moedALine('16 November 2026', 55)).toBe('You first sat it on 16 November 2026 and got 55.')
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

  it('Keep it as a memory on the exam screen: the flower opens in the sheet, not on the card behind it', async () => {
    const fake = setup([PENDING])
    // The close succeeds and the exams refresh then says "done": the card behind the modal appears.
    fake.on('POST /exams/p1/close', () => {
      fake.on('GET /exams', [{ ...PENDING, state: 'done', closed_at: '2026-11-23T12:00:00Z' }])
      return makeCloseResult({ event: { kind: 'course_bloomed', exam_id: 'p1', exam_name: 'הסתברות', color_index: 2 } })
    })
    openRoute(fake, '/exams/p1')
    const u = user()
    await u.click(await screen.findByRole('button', { name: c.card.open }))
    const sheet = await screen.findByRole('dialog', { name: c.sheet.title('הסתברות') })
    await u.click(within(sheet).getByRole('button', { name: c.sheet.nailed }))
    const after = await screen.findByRole('dialog', { name: c.sheet.bloomed('הסתברות') })
    // The card behind the sheet is drawn too (the exams query was refreshed).
    await waitFor(() => {
      expect(screen.getAllByText(c.archived.say('הסתברות'), { selector: 'p', ignore: '[role="dialog"] *' }).length).toBeGreaterThan(0)
    })
    const slots = [...document.querySelectorAll('[data-slot="bloom"]')]
    expect(slots).toHaveLength(2)
    // The figure stands on the sheet's modal, beside the element with role dialog.
    const modal = after.parentElement?.parentElement
    if (modal === null || modal === undefined) throw new Error('no modal')
    const inSheet = slots.filter((s) => modal.contains(s))
    const onCard = slots.filter((s) => !modal.contains(s))
    expect(inSheet).toHaveLength(1)
    expect(inSheet[0]?.querySelector('.garden-petal')).not.toBeNull()
    expect(onCard[0]?.querySelector('.garden-petal')).toBeNull()
  })

  it('waiting for a retake: what is kept, Plan the retake, and Keep it as a memory; no edit and no plan request', async () => {
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
    expect(document.querySelector('[data-slot="bloom"] svg')).not.toBeNull()
    expect(document.querySelector('[data-slot="bloom"] img')).toBeNull()
    expect(document.querySelector('[data-slot="bloom"] .garden-petal')).toBeNull()
    expect(screen.getByText(c.archived.say('לוגיקה'))).toHaveClass('text-body', 'font-semibold')
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

  it('Plan the retake waits while the exam is being closed', async () => {
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

  it('after Keep it as a memory, the focus lands on the archive card, not on the page', async () => {
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

// The server of a delete in small: DELETE takes the exam out of GET /exams and GET /closures, the Undo
// puts it back as it was. ACTIVE stays, so the list after it has its h1.
function deletable(fake: ReturnType<typeof setup>, exam: typeof PENDING, reply: () => unknown = () => makeDeleteResult()) {
  const item = makeClosureItem({
    exam_id: exam.id,
    exam_name: exam.name,
    color_index: exam.color_index,
    state: exam.state === 'waiting_moed_b' ? 'waiting_moed_b' : 'pending',
    tasks_total: 17,
  })
  const listed = () => (exam.state === 'waiting_moed_b' ? { pending: [], waiting: [item] } : { pending: [item], waiting: [] })
  fake.on(`DELETE /exams/${exam.id}`, async () => {
    const answer = await reply()
    fake.on('GET /exams', [ACTIVE])
    fake.on('GET /closures', { pending: [], waiting: [] })
    return answer
  })
  fake.on('POST /plan/undo', () => {
    fake.on('GET /exams', [exam, ACTIVE])
    fake.on('GET /closures', listed())
    return {}
  })
}

// S45b Task 3: "Delete it" on the exam screen.
describe('the exam screen: Delete it', () => {
  it('waiting for a retake: three buttons; Delete it goes to the exams list with a toast and its Undo', async () => {
    const fake = setup([WAITING, ACTIVE])
    deletable(fake, WAITING)
    openRoute(fake, '/exams/w1')
    expect(await screen.findByText(c.waiting.say('אלגוריתמים'))).toBeInTheDocument()
    expect(within(screen.getByRole('main')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Plan the retake', 'Keep it as a memory', 'Delete it'])

    const u = user()
    await u.click(screen.getByRole('button', { name: c.waiting.delete }))
    expect(await screen.findByRole('heading', { level: 1, name: t.list.title })).toBeInTheDocument()
    expect(fake.calls('DELETE', '/exams/w1')).toHaveLength(1)
    const region = await screen.findByRole('region', { name: en.common.notifications })
    expect(within(region).getByText(c.sheet.deleted('אלגוריתמים'))).toBeInTheDocument()
    expect(fake.calls('POST', /close$/)).toHaveLength(0)

    await u.click(within(region).getByRole('button', { name: en.common.undo }))
    expect(await screen.findByText(c.sheet.undone('אלגוריתמים'))).toBeInTheDocument()
    expect(fake.calls('POST', '/plan/undo').map((x) => x.body)).toEqual([{ version_id: 'v-del' }])
    // The list has it back.
    expect(await screen.findByRole('link', { name: /אלגוריתמים/ })).toBeInTheDocument()
  })

  it('waiting: while it is being deleted the other two wait', async () => {
    const fake = setup([WAITING, ACTIVE])
    const reply = later<unknown>()
    deletable(fake, WAITING, () => reply.promise)
    openRoute(fake, '/exams/w1')
    const u = user()
    await u.click(await screen.findByRole('button', { name: c.waiting.delete }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: c.waiting.plan })).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: c.waiting.done })).toBeDisabled()
    await act(async () => {
      reply.resolve(makeDeleteResult())
      await Promise.resolve()
    })
    expect(await screen.findByRole('heading', { level: 1, name: t.list.title })).toBeInTheDocument()
  })

  it('pending: Choose opens the sheet; after Delete it the sheet and its Undo stay once the exam is gone; Close goes to the list', async () => {
    const fake = setup([PENDING, ACTIVE])
    deletable(fake, PENDING)
    openRoute(fake, '/exams/p1')
    const u = user()
    await u.click(await screen.findByRole('button', { name: c.card.open }))
    const sheet = await screen.findByRole('dialog', { name: c.sheet.title('הסתברות') })
    const before = fake.calls('GET', '/exams').length
    await u.click(within(sheet).getByRole('button', { name: c.sheet.delete }))
    const after = await screen.findByRole('dialog', { name: c.sheet.deleted('הסתברות') })
    await waitFor(() => {
      expect(fake.calls('GET', '/exams').length).toBeGreaterThan(before)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByRole('dialog', { name: c.sheet.deleted('הסתברות') })).toBe(after)
    expect(within(after).getByRole('button', { name: en.common.undo })).toBeInTheDocument()
    // The screen under it says the exam is gone.
    expect(screen.getByText(t.notFound)).toBeInTheDocument()
    const close = within(after)
      .getAllByRole('button', { name: en.common.close })
      .find((b) => b.textContent === en.common.close)
    if (close === undefined) throw new Error('no primary Close')
    await u.click(close)
    expect(await screen.findByRole('heading', { level: 1, name: t.list.title })).toBeInTheDocument()
  })

  it('pending: Undo in the sheet brings the exam back, and its screen shows it with the question', async () => {
    const fake = setup([PENDING, ACTIVE])
    deletable(fake, PENDING)
    openRoute(fake, '/exams/p1')
    const u = user()
    await u.click(await screen.findByRole('button', { name: c.card.open }))
    const sheet = await screen.findByRole('dialog', { name: c.sheet.title('הסתברות') })
    await u.click(within(sheet).getByRole('button', { name: c.sheet.delete }))
    const after = await screen.findByRole('dialog', { name: c.sheet.deleted('הסתברות') })
    await waitFor(() => {
      expect(screen.getByText(t.notFound)).toBeInTheDocument()
    })
    await u.click(within(after).getByRole('button', { name: en.common.undo }))
    const back = await screen.findByRole('dialog', { name: c.sheet.title('הסתברות') })
    expect(within(back).getByRole('status')).toHaveTextContent(c.sheet.undone('הסתברות'))
    expect(fake.calls('POST', '/plan/undo').map((x) => x.body)).toEqual([{ version_id: 'v-del' }])
    // Under the modal sheet the screen is hidden from the accessibility tree.
    expect(await screen.findByRole('heading', { level: 1, name: 'הסתברות', hidden: true })).toBeInTheDocument()
    expect(screen.queryByText(t.notFound)).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByRole('dialog', { name: c.sheet.title('הסתברות') })).toBeInTheDocument()
  })

  it('an exam that passed a week ago, never decided: the same card and the same three answers', async () => {
    const OLD = examFixture({ id: 'o1', name: 'הסתברות', exam_date: '2026-11-16', color_index: 2, state: 'pending', sitting: 1 })
    const fake = setup([OLD])
    openRoute(fake, '/exams/o1')
    expect(await screen.findByText(c.sheet.title('הסתברות'))).toBeInTheDocument()
    await user().click(screen.getByRole('button', { name: c.card.open }))
    const sheet = await screen.findByRole('dialog', { name: c.sheet.title('הסתברות') })
    expect(within(sheet).getAllByRole('button', { name: /it/ }).map((b) => b.textContent)).toEqual([
      c.sheet.nailed,
      c.sheet.keepOpen,
      c.sheet.delete,
    ])
  })
})

// Fix round 1 of Task 3: a refresh that lands after the server committed the delete and before its
// answer takes the card off the screen; the screen still goes to the list, with the toast said once.
describe('the exam screen: a delete from the card that a refresh overtakes', () => {
  function committedEarly(reply: () => Promise<unknown>) {
    const fake = setup([WAITING, ACTIVE])
    fake.on('DELETE /exams/w1', () => {
      // The server has committed; its answer is still on the way.
      fake.on('GET /exams', [ACTIVE])
      fake.on('GET /closures', { pending: [], waiting: [] })
      return reply()
    })
    fake.on('POST /plan/undo', {})
    return fake
  }

  async function endsOnTheList() {
    expect(await screen.findByRole('heading', { level: 1, name: t.list.title })).toBeInTheDocument()
    const region = await screen.findByRole('region', { name: en.common.notifications })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(within(region).getAllByText(c.sheet.deleted('אלגוריתמים'))).toHaveLength(1)
    expect(within(region).getByRole('button', { name: en.common.undo })).toBeInTheDocument()
  }

  it('the closures refresh: the page ends on the exams list, with the toast once', async () => {
    const reply = later<unknown>()
    const fake = committedEarly(() => reply.promise)
    openRoute(fake, '/exams/w1')
    await user().click(await screen.findByRole('button', { name: c.waiting.delete }))
    const before = fake.calls('GET', '/closures').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 100)
    })
    await waitFor(() => {
      expect(fake.calls('GET', '/closures').length).toBeGreaterThan(before)
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: c.waiting.delete })).not.toBeInTheDocument()
    })
    await act(async () => {
      reply.resolve(makeDeleteResult())
      await Promise.resolve()
    })
    await endsOnTheList()
  })

  it('the exams refetch on focus: the page ends on the exams list, with the toast once', async () => {
    const reply = later<unknown>()
    const fake = committedEarly(() => reply.promise)
    openRoute(fake, '/exams/w1')
    await user().click(await screen.findByRole('button', { name: c.waiting.delete }))
    const before = fake.calls('GET', '/exams').length
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await waitFor(() => {
      expect(fake.calls('GET', '/exams').length).toBeGreaterThan(before)
    })
    await act(async () => {
      focusManager.setFocused(undefined)
      reply.resolve(makeDeleteResult())
      await Promise.resolve()
    })
    await endsOnTheList()
  })

  it('a 404 from the card ends on the exams list', async () => {
    const fake = setup([WAITING, ACTIVE])
    fake.on('DELETE /exams/w1', () => {
      // Deleted elsewhere already: the refresh after the answer has it gone.
      fake.on('GET /exams', [ACTIVE])
      fake.on('GET /closures', { pending: [], waiting: [] })
      return problem(404, 'not_found')
    })
    openRoute(fake, '/exams/w1')
    await user().click(await screen.findByRole('button', { name: c.waiting.delete }))
    expect(await screen.findByRole('heading', { level: 1, name: t.list.title })).toBeInTheDocument()
    expect(await screen.findByText(codeText('not_found'))).toBeInTheDocument()
  })
})

// The final review of S45b: after a delete the screen it leaves is gone, and so is the pressed button;
// the focus goes to the h1 of the list (useRouteFocus, focusTitle on a replace).
describe('the exam screen: the focus and the way out after a delete', () => {
  it('a delete from the waiting card puts the focus on the h1 of the list', async () => {
    const fake = setup([WAITING, ACTIVE])
    deletable(fake, WAITING)
    openRoute(fake, '/exams/w1')
    await user().click(await screen.findByRole('button', { name: c.waiting.delete }))
    const heading = await screen.findByRole('heading', { level: 1, name: t.list.title })
    await waitFor(() => {
      expect(heading).toHaveFocus()
    })
  })

  it('Close on the sheet after a delete puts the focus on the h1 of the list', async () => {
    const fake = setup([PENDING, ACTIVE])
    deletable(fake, PENDING)
    openRoute(fake, '/exams/p1')
    const u = user()
    await u.click(await screen.findByRole('button', { name: c.card.open }))
    const sheet = await screen.findByRole('dialog', { name: c.sheet.title('הסתברות') })
    await u.click(within(sheet).getByRole('button', { name: c.sheet.delete }))
    const after = await screen.findByRole('dialog', { name: c.sheet.deleted('הסתברות') })
    await waitFor(() => {
      expect(screen.getByText(t.notFound)).toBeInTheDocument()
    })
    const close = within(after)
      .getAllByRole('button', { name: en.common.close })
      .find((b) => b.textContent === en.common.close)
    if (close === undefined) throw new Error('no primary Close')
    await u.click(close)
    const heading = await screen.findByRole('heading', { level: 1, name: t.list.title })
    await waitFor(() => {
      expect(heading).toHaveFocus()
    })
    // Still there after the frame in which React Aria would give the focus back to the trigger.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(heading).toHaveFocus()
  })

  it('a 404 from the sheet on the exam screen ends on the exams list', async () => {
    const fake = setup([PENDING, ACTIVE])
    fake.on('DELETE /exams/p1', () => {
      // Deleted elsewhere already: the refresh after the answer has it gone.
      fake.on('GET /exams', [ACTIVE])
      fake.on('GET /closures', { pending: [], waiting: [] })
      return problem(404, 'not_found')
    })
    openRoute(fake, '/exams/p1')
    const u = user()
    await u.click(await screen.findByRole('button', { name: c.card.open }))
    const sheet = await screen.findByRole('dialog', { name: c.sheet.title('הסתברות') })
    await u.click(within(sheet).getByRole('button', { name: c.sheet.delete }))
    expect(await screen.findByRole('heading', { level: 1, name: t.list.title })).toBeInTheDocument()
    expect(await screen.findByText(codeText('not_found'))).toBeInTheDocument()
  })
})
