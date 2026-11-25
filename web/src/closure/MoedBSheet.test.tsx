import { screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../i18n/en'
import { isolate } from '../i18n/bidi'
import { makeMe, renderBoard } from '../test/boardFixtures'
import { makeClosureItem, makeMoedBResult } from '../test/closureFixtures'
import { createFakeApi, problem, type Reply } from '../test/fakeApi'
import { MoedBForm } from './MoedBSheet'
import type { ClosureItem, MoedBResult } from './types'

vi.mock('../board/offerReplan', () => ({ useOfferReplan: () => vi.fn() }))

const m = en.closure.moedB
const f = en.onboardingExams
const MOED_B_PATH = '/exams/exam-1/moed-b'

// 20:00 in Jerusalem on the evening of the exam: the profile's today is 23 November 2026.
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

function setup({ item = makeClosureItem(), moedB = makeMoedBResult() }: { item?: ClosureItem; moedB?: Reply } = {}) {
  const fake = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /exams/exam-1/tasks', [])
    .on(`POST ${MOED_B_PATH}`, moedB)
  const onDone = vi.fn<(result: MoedBResult, simulations: number) => void>()
  const onPendingChange = vi.fn<(pending: boolean) => void>()
  renderBoard(<MoedBForm item={item} onDone={onDone} onPendingChange={onPendingChange} />, { api: fake.api })
  return { fake, onDone, onPendingChange }
}

async function ready(fake: ReturnType<typeof createFakeApi>) {
  await waitFor(() => {
    expect(fake.calls('GET', '/me')).toHaveLength(1)
  })
}

// The segments are day, month, year (en-GB).
async function typeDate(u: UserEvent, iso: string) {
  const [year, month, day] = iso.split('-')
  const group = screen.getByRole('group', { name: m.date })
  const [first] = within(group).getAllByRole('spinbutton')
  if (first === undefined) throw new Error('no date segments')
  await u.click(first)
  await u.keyboard(`${String(day)}${String(month)}${String(year)}`)
}

const submit = () => screen.getByRole('button', { name: m.submit })

describe('MoedBForm', () => {
  it('asks for the date next to its field and sends nothing without it', async () => {
    const { fake } = setup()
    await ready(fake)
    const u = user()
    await u.click(submit())
    expect(await screen.findByText(f.dateRequired)).toBeInTheDocument()
    expect(fake.calls('POST', MOED_B_PATH)).toHaveLength(0)
  })

  it('stops a grade of 101 next to its field', async () => {
    const { fake } = setup()
    await ready(fake)
    const u = user()
    await typeDate(u, '2026-12-20')
    await u.type(screen.getByRole('textbox', { name: m.grade }), '101')
    await u.click(submit())
    expect(await screen.findByText(m.gradeError)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: m.grade })).toHaveAttribute('aria-invalid', 'true')
    expect(fake.calls('POST', MOED_B_PATH)).toHaveLength(0)
  })

  it('sends every filled field, exactly', async () => {
    const { fake, onDone } = setup()
    await ready(fake)
    const u = user()
    await typeDate(u, '2026-12-20')
    await u.type(screen.getByRole('textbox', { name: m.grade }), '55')
    await u.click(screen.getByRole('checkbox', { name: isolate('תוחלת ושונות') }))
    await u.type(screen.getByRole('textbox', { name: m.notes }), 'the proofs')
    await u.click(submit())
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1)
    })
    expect(fake.calls('POST', MOED_B_PATH).map((c) => c.body)).toEqual([
      { exam_date: '2026-12-20', grade: 55, hard_topic_ids: ['topic-2'], hard_notes: 'the proofs' },
    ])
    expect(onDone).toHaveBeenCalledWith(makeMoedBResult(), 1)
  })

  it('sends only the date when only the date is filled', async () => {
    const { fake, onDone } = setup()
    await ready(fake)
    const u = user()
    await typeDate(u, '2026-12-20')
    await u.click(submit())
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1)
    })
    expect(fake.calls('POST', MOED_B_PATH).map((c) => c.body)).toEqual([{ exam_date: '2026-12-20' }])
  })

  it('puts exam_in_past from the server next to the date and keeps the values', async () => {
    const { fake, onDone } = setup({ moedB: problem(422, 'exam_in_past') })
    await ready(fake)
    const u = user()
    await typeDate(u, '2026-12-20')
    await u.type(screen.getByRole('textbox', { name: m.grade }), '55')
    await u.click(submit())
    expect(await screen.findByText(f.dateTooEarly)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: m.grade })).toHaveValue('55')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('shows Planning… while it waits, and says it is pending', async () => {
    const reply = later<MoedBResult>()
    const { fake, onPendingChange, onDone } = setup({ moedB: () => reply.promise })
    await ready(fake)
    const u = user()
    await typeDate(u, '2026-12-20')
    await u.click(submit())
    expect(await screen.findByRole('button', { name: m.submitting })).toBeInTheDocument()
    expect(onPendingChange).toHaveBeenLastCalledWith(true)
    reply.resolve(makeMoedBResult())
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(onPendingChange).toHaveBeenLastCalledWith(false)
    })
  })

  it('has no hard-topics group when the exam has no topics', async () => {
    const { fake } = setup({ item: makeClosureItem({ topics: [] }) })
    await ready(fake)
    expect(screen.getByRole('group', { name: m.date })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: m.hard })).not.toBeInTheDocument()
    expect(screen.queryByText(m.notesHint)).not.toBeInTheDocument()
  })

  it('shows the hard topics with their hint when there are topics', async () => {
    const { fake } = setup()
    await ready(fake)
    const group = screen.getByRole('group', { name: m.hard })
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByText(m.hardHint)).toBeInTheDocument()
    expect(screen.getByText(m.notesHint)).toBeInTheDocument()
  })
})
