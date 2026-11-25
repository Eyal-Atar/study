import { useEffect, useState } from 'react'
import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorMessage } from '../api/client'
import { codeText } from '../i18n/codes'
import { en } from '../i18n/en'
import { makeMe, renderBoard } from '../test/boardFixtures'
import { makeClosureItem, makeCloseResult, makeDeleteResult, makeMoedBResult } from '../test/closureFixtures'
import { createFakeApi, problem, type Reply } from '../test/fakeApi'
import { useClosures } from './api'
import { ClosureSheet } from './ClosureSheet'
import { MoedBSheet } from './MoedBSheet'
import type { CloseResult, ClosureItem, MoedBResult } from './types'

vi.mock('../board/offerReplan', () => ({ useOfferReplan: () => vi.fn() }))

const s = en.closure.sheet
const m = en.closure.moedB
const FIRST = makeClosureItem()
const SECOND = makeClosureItem({ exam_id: 'exam-2', exam_name: 'אלגוריתמים', exam_date: '2026-11-23', color_index: 4 })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-11-23T18:00:00Z'))
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

// The calendar's part (Task 5) in small: the sheet is drawn once GET /closures has answered, and taken
// off the tree when it asks to close.
let hideSheet: () => void = () => undefined
function Harness({ onClose, onShown }: { onClose: () => void; onShown: (item: ClosureItem) => void }) {
  const closures = useClosures()
  const [open, setOpen] = useState(true)
  // The screen changes under a sheet that waits for its answer (the student went elsewhere).
  useEffect(() => {
    hideSheet = () => {
      setOpen(false)
    }
  })
  if (!open || closures.data === undefined) return null
  return (
    <ClosureSheet
      examId="exam-1"
      pending={closures.data.pending}
      onClose={() => {
        onClose()
        setOpen(false)
      }}
      onShown={onShown}
    />
  )
}

// The server in small: a decision takes the exam out of pending, an Undo puts it back.
function setup({
  pending = [FIRST],
  close,
  undo = {},
  moedB = makeMoedBResult(),
  remove,
}: { pending?: ClosureItem[]; close?: Reply; undo?: Reply; moedB?: Reply; remove?: Reply } = {}) {
  let live = [...pending]
  let lastClosed: string | null = null
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /closures', () => ({ pending: live, waiting: [] }))
    .on({ method: 'GET', path: /^\/exams\/exam-\d\/tasks$/ }, [])
    .on({ method: 'POST', path: /^\/exams\/exam-\d\/close$/ }, (call: { path: string }) => {
      const id = call.path.split('/')[2] ?? ''
      if (close !== undefined) return typeof close === 'function' ? (close as (c: unknown) => unknown)(call) : close
      lastClosed = id
      live = live.filter((i) => i.exam_id !== id)
      return makeCloseResult({ version_id: `version-${id}` })
    })
    .on({ method: 'DELETE', path: /^\/exams\/exam-\d$/ }, (call: { path: string }) => {
      const id = call.path.split('/')[2] ?? ''
      if (remove !== undefined) return typeof remove === 'function' ? (remove as (c: unknown) => unknown)(call) : remove
      lastClosed = id
      live = live.filter((i) => i.exam_id !== id)
      return makeDeleteResult()
    })
    .on('POST /exams/exam-1/moed-b', moedB)
    .on('POST /plan/undo', () => {
      if (undo instanceof Error) return undo
      const back = pending.find((i) => i.exam_id === lastClosed)
      if (back !== undefined && !live.includes(back)) live = [back, ...live]
      return undo
    })
  const onClose = vi.fn()
  const onShown = vi.fn<(item: ClosureItem) => void>()
  const view = renderBoard(<Harness onClose={onClose} onShown={onShown} />, { api: fake.api })
  return { fake, onClose, onShown, ...view }
}

const dialog = (name: string) => screen.findByRole('dialog', { name })
// The primary Close of a state "after", not the X of the dialog (both say Close).
function primaryClose() {
  const buttons = screen.getAllByRole('button', { name: en.common.close })
  const primary = buttons.find((b) => b.textContent === en.common.close)
  if (primary === undefined) throw new Error('no primary Close')
  return primary
}

async function typeDate(u: UserEvent, iso: string) {
  const [year, month, day] = iso.split('-')
  const group = screen.getByRole('group', { name: m.date })
  const [first] = within(group).getAllByRole('spinbutton')
  if (first === undefined) throw new Error('no date segments')
  await u.click(first)
  await u.keyboard(`${String(day)}${String(month)}${String(year)}`)
}

describe('ClosureSheet: the question', () => {
  it('asks what to do with it, with the summary and the three answers in order', async () => {
    const { onShown } = setup()
    const sheet = await dialog(s.title('הסתברות'))
    expect(within(sheet).getByText('You studied 21 hours and finished 86% of the plan.')).toBeInTheDocument()
    expect(within(sheet).getAllByRole('button', { name: /it/ }).map((b) => b.textContent)).toEqual([
      'Keep it as a memory',
      'Keep it open for a retake',
      'Delete it',
    ])
    expect([s.nailed, s.keepOpen, s.delete]).toEqual(['Keep it as a memory', 'Keep it open for a retake', 'Delete it'])
    await waitFor(() => {
      expect(onShown).toHaveBeenCalledTimes(1)
    })
    expect(onShown).toHaveBeenCalledWith(FIRST)
  })

  it('offers Keep it as a memory and Delete it in a retake, not another retake', async () => {
    setup({ pending: [makeClosureItem({ options: ['done'], sitting: 2 })] })
    const sheet = await dialog(s.title('הסתברות'))
    expect(within(sheet).getAllByRole('button', { name: /it/ }).map((b) => b.textContent)).toEqual([s.nailed, s.delete])
    expect(within(sheet).queryByRole('button', { name: s.keepOpen })).not.toBeInTheDocument()
  })

  it('says no time and no summary line as the numbers ask', async () => {
    setup({ pending: [makeClosureItem({ studied_minutes: 0 })] })
    const sheet = await dialog(s.title('הסתברות'))
    expect(within(sheet).getByText(s.statsNoTime(86))).toBeInTheDocument()
  })

  it('has no summary line when the exam had no tasks', async () => {
    setup({ pending: [makeClosureItem({ tasks_total: 0, studied_minutes: 0, completion_percent: 0 })] })
    const sheet = await dialog(s.title('הסתברות'))
    expect(within(sheet).queryByText(/of the plan/)).not.toBeInTheDocument()
  })

  it('closes when the exam is no longer pending', async () => {
    const { onClose, queryClient, fake } = setup()
    await dialog(s.title('הסתברות'))
    fake.on('GET /closures', { pending: [], waiting: [] })
    await act(async () => {
      await queryClient.invalidateQueries()
    })
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})

describe('ClosureSheet: the decision', () => {
  it('Keep it as a memory closes done; the sheet holds while it waits, then blooms', async () => {
    const reply = later<CloseResult>()
    const { fake, onClose } = setup({ close: () => reply.promise })
    const u = user()
    const sheet = await dialog(s.title('הסתברות'))
    await u.click(within(sheet).getByRole('button', { name: s.nailed }))
    expect(fake.calls('POST', '/exams/exam-1/close').map((c) => c.body)).toEqual([{ outcome: 'done' }])
    await waitFor(() => {
      expect(within(sheet).getByRole('button', { name: s.keepOpen })).toBeDisabled()
    })
    expect(within(sheet).queryByRole('button', { name: en.common.close })).not.toBeInTheDocument()
    await u.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: s.title('הסתברות') })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    reply.resolve(makeCloseResult())
    const after = await dialog(s.bloomed('הסתברות'))
    expect(within(after).getByRole('status')).toHaveTextContent(s.bloomed('הסתברות'))
    await waitFor(() => {
      expect(primaryClose()).toHaveFocus()
    })
    expect(document.querySelector('[data-slot="bloom"]')).not.toBeNull()
    await u.click(primaryClose())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a refetch without the exam while the close is on its way does not close the sheet', async () => {
    const reply = later<CloseResult>()
    const { fake, onClose, queryClient } = setup({ close: () => reply.promise })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.nailed }))
    // The server committed; the 5-minute refetch answers before the close does.
    fake.on('GET /closures', { pending: [], waiting: [] })
    await act(async () => {
      await queryClient.invalidateQueries()
    })
    await waitFor(() => {
      expect(fake.calls('GET', '/closures').length).toBeGreaterThan(1)
    })
    expect(onClose).not.toHaveBeenCalled()
    reply.resolve(makeCloseResult())
    expect(await dialog(s.bloomed('הסתברות'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.common.undo })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('an exam decided elsewhere closes the question with a word, not in silence', async () => {
    const { fake, onClose, queryClient } = setup()
    await dialog(s.title('הסתברות'))
    // Decided in another tab; this one refreshes (the window's focus).
    fake.on('GET /closures', { pending: [], waiting: [] })
    await act(async () => {
      await queryClient.invalidateQueries()
    })
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    const region = await screen.findByRole('region', { name: en.common.notifications })
    expect(within(region).getAllByText(s.stale)).toHaveLength(1)
  })

  it('Keep it open for a retake keeps it quiet and offers the date', async () => {
    const { fake } = setup()
    const u = user()
    const sheet = await dialog(s.title('הסתברות'))
    await u.click(within(sheet).getByRole('button', { name: s.keepOpen }))
    const after = await dialog(s.kept('הסתברות'))
    expect(fake.calls('POST', '/exams/exam-1/close').map((c) => c.body)).toEqual([{ outcome: 'moed_b' }])
    expect(within(after).getByRole('button', { name: s.haveDate })).toBeInTheDocument()
    expect(within(after).getByRole('status')).toHaveTextContent(s.kept('הסתברות'))
    expect(document.querySelector('[data-slot="bloom"]')).toBeNull()
  })

  it('goes on to the next exam of the day, then closes', async () => {
    const { onShown, fake } = setup({ pending: [FIRST, SECOND] })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.nailed }))
    const next = await screen.findByRole('button', { name: s.next('אלגוריתמים') })
    await waitFor(() => {
      expect(next).toHaveFocus()
    })
    await u.click(next)
    const second = await dialog(s.title('אלגוריתמים'))
    expect(within(second).getByRole('status')).toHaveTextContent(s.title('אלגוריתמים'))
    await waitFor(() => {
      expect(onShown).toHaveBeenCalledWith(SECOND)
    })
    expect(onShown).toHaveBeenCalledTimes(2)
    await u.click(within(second).getByRole('button', { name: s.nailed }))
    await dialog(s.bloomed('אלגוריתמים'))
    expect(fake.calls('POST', '/exams/exam-2/close')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Tell me about/ })).not.toBeInTheDocument()
    expect(primaryClose()).toBeInTheDocument()
  })

  it('a stale decision closes the sheet with a word', async () => {
    const { onClose } = setup({ close: problem(409, 'invalid_state') })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.nailed }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText(s.stale)).toBeInTheDocument()
  })

  it('any other failure stays in the sheet, on the question', async () => {
    const failure = problem(500, 'internal_error')
    const { onClose } = setup({ close: failure })
    const u = user()
    const sheet = await dialog(s.title('הסתברות'))
    await u.click(within(sheet).getByRole('button', { name: s.nailed }))
    expect(await within(sheet).findByText(errorMessage(failure))).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: s.nailed })).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// S45b Task 3: "Delete it", without a confirmation and with its Undo.
describe('ClosureSheet: Delete it', () => {
  it('deletes; the sheet holds while it waits, even through a refetch without the exam, then says it', async () => {
    const reply = later<unknown>()
    const { fake, onClose, queryClient } = setup({ remove: () => reply.promise })
    const u = user()
    const sheet = await dialog(s.title('הסתברות'))
    await u.click(within(sheet).getByRole('button', { name: s.delete }))
    expect(fake.calls('DELETE', '/exams/exam-1')).toHaveLength(1)
    await waitFor(() => {
      expect(within(sheet).getByRole('button', { name: s.nailed })).toBeDisabled()
    })
    expect(within(sheet).getByRole('button', { name: s.keepOpen })).toBeDisabled()
    expect(within(sheet).queryByRole('button', { name: en.common.close })).not.toBeInTheDocument()
    await u.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: s.title('הסתברות') })).toBeInTheDocument()
    // The server committed; a refetch answers before the delete does.
    fake.on('GET /closures', { pending: [], waiting: [] })
    const before = fake.calls('GET', '/closures').length
    await act(async () => {
      await queryClient.invalidateQueries()
    })
    await waitFor(() => {
      expect(fake.calls('GET', '/closures').length).toBeGreaterThan(before)
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText(s.stale)).not.toBeInTheDocument()

    await act(async () => {
      reply.resolve(makeDeleteResult())
      await Promise.resolve()
    })
    const after = await dialog(s.deleted('הסתברות'))
    expect(within(after).getByRole('status')).toHaveTextContent(s.deleted('הסתברות'))
    await waitFor(() => {
      expect(primaryClose()).toHaveFocus()
    })
    expect(document.querySelector('[data-slot="bloom"]')).toBeNull()
    expect(within(after).queryByRole('button', { name: s.haveDate })).not.toBeInTheDocument()
    expect(within(after).getByRole('button', { name: en.common.undo })).toBeInTheDocument()
    expect(fake.calls('POST', /close$/)).toHaveLength(0)
    expect(screen.queryByText(s.stale)).not.toBeInTheDocument()
    await u.click(primaryClose())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the pressed Delete it waits; the other two are disabled', async () => {
    const reply = later<unknown>()
    setup({ remove: () => reply.promise })
    const u = user()
    const sheet = await dialog(s.title('הסתברות'))
    await u.click(within(sheet).getByRole('button', { name: s.delete }))
    await waitFor(() => {
      expect(within(sheet).getByRole('button', { name: s.delete })).toHaveAttribute('data-pending', 'true')
    })
    expect(within(sheet).getByRole('button', { name: s.nailed })).not.toHaveAttribute('data-pending')
    await act(async () => {
      reply.resolve(makeDeleteResult())
      await Promise.resolve()
    })
    await dialog(s.deleted('הסתברות'))
  })

  it('Undo sends one /plan/undo and asks the question again', async () => {
    const { fake } = setup()
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.delete }))
    await dialog(s.deleted('הסתברות'))
    const undo = screen.getByRole('button', { name: en.common.undo })
    await u.click(undo)
    await u.click(undo)
    const back = await dialog(s.title('הסתברות'))
    expect(fake.calls('POST', '/plan/undo').map((c) => c.body)).toEqual([{ version_id: 'v-del' }])
    expect(within(back).getByRole('status')).toHaveTextContent(s.undone('הסתברות'))
    await waitFor(() => {
      expect(within(back).getByRole('button', { name: s.nailed })).toHaveFocus()
    })
    // The refetch puts it back into pending: the question stays.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByRole('dialog', { name: s.title('הסתברות') })).toBeInTheDocument()
  })

  it('without a version there is no Undo', async () => {
    setup({ remove: makeDeleteResult({ version_id: null }) })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.delete }))
    const after = await dialog(s.deleted('הסתברות'))
    expect(within(after).queryByRole('button', { name: en.common.undo })).not.toBeInTheDocument()
    expect(primaryClose()).toBeInTheDocument()
  })

  it('goes on to the next exam of the day', async () => {
    setup({ pending: [FIRST, SECOND] })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.delete }))
    await dialog(s.deleted('הסתברות'))
    const next = await screen.findByRole('button', { name: s.next('אלגוריתמים') })
    await waitFor(() => {
      expect(next).toHaveFocus()
    })
    await u.click(next)
    expect(await dialog(s.title('אלגוריתמים'))).toBeInTheDocument()
  })

  it('a 404 closes the sheet with a word', async () => {
    const { onClose } = setup({ remove: problem(404, 'not_found') })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.delete }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(await screen.findByText(codeText('not_found'))).toBeInTheDocument()
  })

  it('any other failure stays in the sheet, on the question', async () => {
    const failure = problem(500, 'internal_error')
    const { onClose } = setup({ remove: failure })
    const u = user()
    const sheet = await dialog(s.title('הסתברות'))
    await u.click(within(sheet).getByRole('button', { name: s.delete }))
    expect(await within(sheet).findByText(errorMessage(failure))).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: s.delete })).toBeEnabled()
    expect(within(sheet).getByRole('button', { name: s.nailed })).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
    // Said in the sheet, not in a toast too.
    expect(screen.getAllByText(errorMessage(failure))).toHaveLength(1)
  })

  it('a delete that answers after the sheet left is one toast with its Undo', async () => {
    const reply = later<unknown>()
    setup({ remove: () => reply.promise })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.delete }))
    act(() => {
      hideSheet()
    })
    await act(async () => {
      reply.resolve(makeDeleteResult())
      await Promise.resolve()
    })
    const region = await screen.findByRole('region', { name: en.common.notifications })
    expect(await within(region).findAllByText(s.deleted('הסתברות'))).toHaveLength(1)
    expect(within(region).getByRole('button', { name: en.common.undo })).toBeInTheDocument()
  })
})

describe('ClosureSheet: Undo', () => {
  it('sends one undo for two presses and asks the question again', async () => {
    const { fake } = setup()
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.nailed }))
    await dialog(s.bloomed('הסתברות'))
    const undo = screen.getByRole('button', { name: en.common.undo })
    await u.click(undo)
    await u.click(undo)
    const back = await dialog(s.title('הסתברות'))
    expect(fake.calls('POST', '/plan/undo').map((c) => c.body)).toEqual([{ version_id: 'version-exam-1' }])
    expect(within(back).getByRole('status')).toHaveTextContent(s.undone('הסתברות'))
    await waitFor(() => {
      expect(within(back).getByRole('button', { name: s.nailed })).toHaveFocus()
    })
  })

  it('a failed undo after Keep open moves the focus to the primary button', async () => {
    setup({ undo: problem(409, 'stale_plan') })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.keepOpen }))
    const after = await dialog(s.kept('הסתברות'))
    await u.click(within(after).getByRole('button', { name: en.common.undo }))
    await within(after).findByRole('alert')
    await waitFor(() => {
      expect(document.activeElement).toBe(primaryClose())
    })
  })

  it('a stale undo says why, and the Undo goes away', async () => {
    const failure = problem(409, 'stale_plan')
    setup({ undo: failure })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.nailed }))
    const after = await dialog(s.bloomed('הסתברות'))
    await u.click(within(after).getByRole('button', { name: en.common.undo }))
    expect(await within(after).findByText(errorMessage(failure))).toBeInTheDocument()
    expect(within(after).queryByRole('button', { name: en.common.undo })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).toBe(primaryClose())
    })
  })
})

// The manager's ruling on Task 3: the answer is always said once, by the sheet or else by a toast.
describe('ClosureSheet: an answer after the sheet is gone', () => {
  const notifications = () => screen.queryByRole('region', { name: en.common.notifications })

  it('a close the sheet showed is not a toast too', async () => {
    setup()
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.nailed }))
    await dialog(s.bloomed('הסתברות'))
    const region = notifications()
    if (region !== null) expect(within(region).queryByText(s.bloomed('הסתברות'))).not.toBeInTheDocument()
  })

  it('a close that answers after the sheet left is one toast with its Undo', async () => {
    const reply = later<CloseResult>()
    setup({ close: () => reply.promise })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.keepOpen }))
    act(() => {
      hideSheet()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => {
      reply.resolve(makeCloseResult({ version_id: 'version-exam-1' }))
      await Promise.resolve()
    })
    const region = await screen.findByRole('region', { name: en.common.notifications })
    expect(await within(region).findAllByText(s.kept('הסתברות'))).toHaveLength(1)
    expect(within(region).getByRole('button', { name: en.common.undo })).toBeInTheDocument()
  })
})

describe('ClosureSheet: Moed B', () => {
  it('I have the date opens the form; planning says what comes first', async () => {
    const { fake } = setup({ moedB: makeMoedBResult({ weak_topics: [{ id: 'topic-2', name: 'תוחלת ושונות' }] }) })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.keepOpen }))
    await u.click(await screen.findByRole('button', { name: s.haveDate }))
    const form = await dialog(m.title)
    expect(within(form).getByRole('status')).toHaveTextContent(m.title)
    await typeDate(u, '2026-12-20')
    await u.click(screen.getByRole('button', { name: m.submit }))
    const done = await dialog(m.done(1, ['תוחלת ושונות']))
    expect(fake.calls('POST', '/exams/exam-1/moed-b').map((c) => c.body)).toEqual([{ exam_date: '2026-12-20' }])
    expect(within(done).queryByText(m.short)).not.toBeInTheDocument()
    await waitFor(() => {
      expect(primaryClose()).toHaveFocus()
    })
  })

  async function planned(moedB: MoedBResult) {
    setup({ moedB })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.keepOpen }))
    await u.click(await screen.findByRole('button', { name: s.haveDate }))
    await typeDate(u, '2026-12-20')
    await u.click(screen.getByRole('button', { name: m.submit }))
    return dialog(m.done(1, ['התפלגות בינומית']))
  }

  it('says when not everything of this exam fits', async () => {
    const done = await planned(makeMoedBResult({ shortfalls: [{ exam_id: 'exam-1', minutes: 60, daily_minutes: null }] }))
    expect(within(done).getByText(m.short)).toBeInTheDocument()
    expect(within(done).getByRole('status')).toHaveTextContent(m.short)
  })

  it('says nothing about another exam that is short (the replan covers the whole board)', async () => {
    const done = await planned(
      makeMoedBResult({
        shortfalls: [{ exam_id: 'other-exam', minutes: 60, daily_minutes: null }],
        unscheduled: [{ task_id: 'other-task', minutes: 60, reason: 'not_enough_time', blocked_by: null }],
      }),
    )
    expect(within(done).queryByText(m.short)).not.toBeInTheDocument()
    expect(within(done).getByRole('status')).not.toHaveTextContent(m.short)
  })

  it('Undo of Moed B goes back to an empty form', async () => {
    const { fake } = setup()
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.keepOpen }))
    await u.click(await screen.findByRole('button', { name: s.haveDate }))
    await typeDate(u, '2026-12-20')
    await u.type(screen.getByRole('textbox', { name: m.grade }), '55')
    await u.click(screen.getByRole('button', { name: m.submit }))
    await dialog(m.done(1, ['התפלגות בינומית']))
    await u.click(screen.getByRole('button', { name: en.common.undo }))
    const form = await dialog(m.title)
    expect(fake.calls('POST', '/plan/undo').map((c) => c.body)).toEqual([{ version_id: 'version-2' }])
    expect(within(form).getByRole('status')).toHaveTextContent(m.undone('הסתברות'))
    expect(within(form).getByRole('textbox', { name: m.grade })).toHaveValue('')
  })

  it('Undo of a Moed B already under way says so', async () => {
    setup({ undo: problem(409, 'invalid_state') })
    const u = user()
    await dialog(s.title('הסתברות'))
    await u.click(screen.getByRole('button', { name: s.keepOpen }))
    await u.click(await screen.findByRole('button', { name: s.haveDate }))
    await typeDate(u, '2026-12-20')
    await u.click(screen.getByRole('button', { name: m.submit }))
    const done = await dialog(m.done(1, ['התפלגות בינומית']))
    await u.click(within(done).getByRole('button', { name: en.common.undo }))
    expect(await within(done).findByText(m.cantUndo)).toBeInTheDocument()
    expect(within(done).queryByRole('button', { name: en.common.undo })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(document.activeElement).toBe(primaryClose())
    })
  })
})

describe('MoedBSheet', () => {
  it('asks for the date and says what it planned', async () => {
    const fake = createFakeApi()
      .on('GET /me', makeMe())
      .on('GET /exams/exam-1/tasks', [])
      .on('POST /exams/exam-1/moed-b', makeMoedBResult())
    const onClose = vi.fn()
    renderBoard(<MoedBSheet item={makeClosureItem({ state: 'waiting_moed_b' })} onClose={onClose} />, { api: fake.api })
    const u = user()
    await dialog(m.title)
    await waitFor(() => {
      expect(fake.calls('GET', '/me')).toHaveLength(1)
    })
    await typeDate(u, '2026-12-20')
    await u.click(screen.getByRole('button', { name: m.submit }))
    await dialog(m.done(1, ['התפלגות בינומית']))
    await u.click(primaryClose())
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
