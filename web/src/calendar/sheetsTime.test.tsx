import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { blockName } from '../board/blockName'
import { durationText, formatRange } from '../board/time'
import type { Block } from '../board/types'
import { en } from '../i18n/en'
import { makeBlock, makeMe, makePlan, makeToday, renderBoard } from '../test/boardFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
import { BusySheet } from './BusySheet'
import { CommitmentSheet } from './CommitmentSheet'
import { FreeTimeSheet } from './FreeTimeSheet'
import type { Ghost } from './ghost'
import { makeBusy } from './testFixtures'

const TZ = 'Asia/Jerusalem'
const TODAY = '2026-11-16'
const NOW = Date.parse('2026-11-16T08:00:00Z')
const HOUR = 3_600_000
const s = en.calendar.sheets

function half(id: string, offsetMin: number, overrides: Partial<Block> = {}): Block {
  const start = NOW + offsetMin * 60_000
  return makeBlock({
    id,
    task_id: `t-${id}`,
    task_title: `Task ${id}`,
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(start + 30 * 60_000).toISOString(),
    ...overrides,
  })
}

function baseFake() {
  return createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', makeToday([makeBlock()]))
    .on({ method: 'GET', path: /^\/plan/ }, makePlan([makeBlock()]))
}

function setupFree(upcoming: Block[], fake = baseFake()) {
  const onClose = vi.fn()
  const onPreview = vi.fn<(ghosts: Ghost[]) => void>()
  renderBoard(
    <FreeTimeSheet isOpen onClose={onClose} upcoming={upcoming} now={NOW} today={TODAY} tz={TZ} onPreview={onPreview} />,
    { api: fake.api },
  )
  return { fake, onClose, onPreview }
}

describe('FreeTimeSheet', () => {
  it('titles the sheet with the question and lists the blocks that fit', async () => {
    const { onPreview } = setupFree([half('a', 60), half('b', 120)])
    await screen.findByRole('dialog', { name: s.freeTime.title })
    await userEvent.click(screen.getByRole('option', { name: '1 hour' }))
    expect(screen.getByText(s.freeTime.nextMany)).toBeInTheDocument()
    expect(screen.getByText('Task a')).toBeInTheDocument()
    expect(screen.getByText('Task b')).toBeInTheDocument()
    const last = onPreview.mock.calls.at(-1)?.[0] ?? []
    expect(last).toHaveLength(2)
    expect(last[0]?.tone).toBe('target')
    expect(last[0]?.endMin).toBe(last[1]?.startMin)
  })

  it('shows no box when the first block is longer than the time', async () => {
    const long = half('a', 60, { ends_at: new Date(NOW + 60 * 60_000 + 90 * 60_000).toISOString() })
    const { onPreview } = setupFree([long])
    await screen.findByRole('dialog')
    expect(screen.queryByText(s.freeTime.nextOne)).not.toBeInTheDocument()
    expect(screen.queryByText(s.freeTime.nextMany)).not.toBeInTheDocument()
    expect(onPreview).toHaveBeenLastCalledWith([])
  })

  it('Start now sends the minutes, and on success toasts and closes', async () => {
    const fake = baseFake().on('POST /plan/free-time', {
      session_starts_at: new Date(NOW).toISOString(),
      session_ends_at: new Date(NOW + HOUR).toISOString(),
      placed_task_ids: ['t-a'],
      blocks: [],
      version_id: 'v1',
    })
    const { onClose } = setupFree([half('a', 60)], fake)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: s.freeTime.start }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(fake.calls('POST', '/plan/free-time')[0]?.body).toEqual({ minutes: 60 })
    const range = formatRange({ starts_at: new Date(NOW).toISOString(), ends_at: new Date(NOW + HOUR).toISOString() }, TZ)
    expect(await screen.findByText(s.freeTime.done(1, range))).toBeInTheDocument()
  })

  it('nothing_to_place stays inside the sheet', async () => {
    const fake = baseFake().on('POST /plan/free-time', problem(409, 'nothing_to_place'))
    const { onClose } = setupFree([], fake)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: s.freeTime.start }))
    expect(await within(screen.getByRole('dialog')).findByText(en.codes.nothing_to_place)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Other offers a select, and 2.5 hours sends 150', async () => {
    const fake = baseFake().on('POST /plan/free-time', problem(409, 'no_free_time'))
    setupFree([], fake)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('option', { name: s.freeTime.options.other }))
    await userEvent.click(screen.getByRole('button', { name: new RegExp(s.freeTime.otherLabel) }))
    await userEvent.click(await screen.findByRole('option', { name: durationText(150) }))
    await userEvent.click(screen.getByRole('button', { name: s.freeTime.start }))
    await waitFor(() => {
      expect(fake.calls('POST', '/plan/free-time')[0]?.body).toEqual({ minutes: 150 })
    })
  })
})

const DRAFT = { date: TODAY, startsAt: '2026-11-16T10:00:00.000Z', endsAt: '2026-11-16T11:00:00.000Z' }

function setupBusy(
  props: { draft?: typeof DRAFT | null; event?: ReturnType<typeof makeBusy> | null; blocks?: Block[] },
  fake = baseFake(),
) {
  const onClose = vi.fn()
  const onPreview = vi.fn<(ghosts: Ghost[]) => void>()
  renderBoard(
    <BusySheet
      draft={props.draft === undefined ? DRAFT : props.draft}
      event={props.event ?? null}
      blocks={props.blocks ?? []}
      tz={TZ}
      today={TODAY}
      onClose={onClose}
      onPreview={onPreview}
    />,
    { api: fake.api },
  )
  return { fake, onClose, onPreview }
}

const NEW_EVENT = {
  event: { id: 'e1', title: null, starts_at: DRAFT.startsAt, ends_at: DRAFT.endsAt, created_at: DRAFT.startsAt },
  blocks: [],
  unplaced: [],
  version_id: null,
}

describe('BusySheet', () => {
  it('sends title null when the title is empty, and closes on 201', async () => {
    const fake = baseFake().on('POST /busy-events', NEW_EVENT)
    const { onClose } = setupBusy({}, fake)
    await screen.findByRole('dialog', { name: s.busy.titleNew })
    await userEvent.click(screen.getByRole('button', { name: s.busy.save }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(fake.calls('POST', '/busy-events')[0]?.body).toEqual({
      title: null,
      starts_at: DRAFT.startsAt,
      ends_at: DRAFT.endsAt,
    })
  })

  it('an end before the start is a field error and sends nothing', async () => {
    const fake = baseFake().on('POST /busy-events', NEW_EVENT)
    setupBusy({ draft: { ...DRAFT, endsAt: '2026-11-16T09:00:00Z' } }, fake)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: s.busy.save }))
    expect(await screen.findByText(en.codes.not_after_starts_at)).toBeInTheDocument()
    expect(fake.calls('POST', '/busy-events')).toHaveLength(0)
  })

  it('names an overlapping block and previews busy time and the leaving block', async () => {
    const overlap = makeBlock({
      id: 'o1',
      task_title: 'פרק 3: גרפים',
      starts_at: '2026-11-16T10:15:00Z',
      ends_at: '2026-11-16T10:45:00Z',
    })
    const { onPreview } = setupBusy({ blocks: [overlap] })
    await screen.findByRole('dialog')
    expect(screen.getByText(s.busy.willMove(1, blockName(overlap)))).toBeInTheDocument()
    const ghosts = onPreview.mock.calls.at(-1)?.[0] ?? []
    expect(ghosts.find((g) => g.id === 'busy-draft')).toMatchObject({ colorIndex: null, tone: 'target', title: en.calendar.grid.newBusy })
    expect(ghosts.find((g) => g.id === 'o1')?.tone).toBe('leaving')
  })

  it('shows event_in_past inside the sheet', async () => {
    const fake = baseFake().on('POST /busy-events', problem(422, 'event_in_past'))
    const { onClose } = setupBusy({}, fake)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: s.busy.save }))
    expect(await within(screen.getByRole('dialog')).findByText(en.codes.event_in_past)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('edits an event: PATCH, with Delete', async () => {
    const event = makeBusy({ source: 'event', id: 'ev-1', kind: null, title: 'Dentist', starts_at: DRAFT.startsAt, ends_at: DRAFT.endsAt })
    const fake = baseFake().on('PATCH /busy-events/ev-1', NEW_EVENT)
    const { onClose } = setupBusy({ draft: null, event }, fake)
    await screen.findByRole('dialog', { name: s.busy.titleEdit })
    expect(screen.getByRole('textbox', { name: s.busy.what })).toHaveValue('Dentist')
    expect(screen.getByRole('button', { name: s.busy.delete })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: s.busy.saveEdit }))
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(fake.calls('PATCH', '/busy-events/ev-1')).toHaveLength(1)
  })

  it('Escape clears the preview', async () => {
    const { onPreview } = setupBusy({})
    await screen.findByRole('dialog')
    onPreview.mockClear()
    await userEvent.keyboard('{Escape}')
    expect(onPreview).toHaveBeenCalledWith([])
  })
})

function Wrap({ onClose, onPreview }: { onClose: () => void; onPreview: (g: Ghost[]) => void }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" data-testid="hide" onClick={() => { setOpen(false) }} />
      <BusySheet draft={open ? DRAFT : null} event={null} blocks={[]} tz={TZ} today={TODAY} onClose={onClose} onPreview={onPreview} />
    </>
  )
}

describe('BusySheet after the sheet is gone or on the way', () => {
  it('a late error shows the toast, and a late success does not close', async () => {
    let release: (value: unknown) => void = () => undefined
    const fake = baseFake().on('POST /busy-events', () => new Promise((resolve) => { release = resolve }))
    const onClose = vi.fn()
    renderBoard(<Wrap onClose={onClose} onPreview={vi.fn()} />, { api: fake.api })
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: s.busy.save }))
    await waitFor(() => { expect(fake.calls('POST', '/busy-events')).toHaveLength(1) })
    fireEvent.click(screen.getByTestId('hide'))
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument() })
    release(problem(422, 'too_many_events'))
    expect(await screen.findByText(en.codes.too_many_events)).toBeInTheDocument()
  })

  it('a late success does not call onClose', async () => {
    let release: (value: unknown) => void = () => undefined
    const fake = baseFake().on('POST /busy-events', () => new Promise((resolve) => { release = resolve }))
    const onClose = vi.fn()
    renderBoard(<Wrap onClose={onClose} onPreview={vi.fn()} />, { api: fake.api })
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: s.busy.save }))
    await waitFor(() => { expect(fake.calls('POST', '/busy-events')).toHaveLength(1) })
    fireEvent.click(screen.getByTestId('hide'))
    await waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument() })
    release(NEW_EVENT)
    expect(await screen.findByText(s.busy.saved)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape does nothing while the request runs', async () => {
    const fake = baseFake().on('POST /busy-events', () => new Promise(() => undefined))
    const { onClose } = setupBusy({}, fake)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: s.busy.save }))
    await waitFor(() => { expect(fake.calls('POST', '/busy-events')).toHaveLength(1) })
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('a leaving ghost sits in the column of the block\u2019s study day', async () => {
    const late = makeBlock({ id: 'o1', study_date: '2026-11-15', starts_at: '2026-11-16T10:15:00Z', ends_at: '2026-11-16T10:45:00Z' })
    const { onPreview } = setupBusy({ blocks: [late] })
    await screen.findByRole('dialog')
    const ghost = (onPreview.mock.calls.at(-1)?.[0] ?? []).find((g) => g.id === 'o1')
    expect(ghost?.date).toBe('2026-11-15')
    expect(ghost?.startMin).toBeGreaterThan(1440)
  })

  it('a server not_after_starts_at is the field error, and the sheet stays open', async () => {
    const fake = baseFake().on('POST /busy-events', problem(422, 'not_after_starts_at'))
    const { onClose } = setupBusy({}, fake)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: s.busy.save }))
    expect(await screen.findByText(en.codes.not_after_starts_at)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('editing an event from an earlier day keeps the date valid', async () => {
    const event = makeBusy({ source: 'event', id: 'ev-1', kind: null, title: 'Trip', starts_at: '2026-11-10T08:00:00.000Z', ends_at: '2026-11-10T09:00:00.000Z' })
    const fake = baseFake().on('PATCH /busy-events/ev-1', NEW_EVENT)
    setupBusy({ draft: null, event }, fake)
    await screen.findByRole('dialog', { name: s.busy.titleEdit })
    await userEvent.click(screen.getByRole('button', { name: s.busy.saveEdit }))
    await waitFor(() => { expect(fake.calls('PATCH', '/busy-events/ev-1')).toHaveLength(1) })
  })

  // S32 final review, M4: an event over midnight or several days keeps its days.
  // 22:00 on the 16th to 08:00 on the 18th, Jerusalem time.
  const LONG = { source: 'event' as const, id: 'ev-1', kind: null, title: 'Trip', starts_at: '2026-11-16T20:00:00.000Z', ends_at: '2026-11-18T06:00:00.000Z' }

  it('a title edit of an event over several days sends the title alone', async () => {
    const fake = baseFake().on('PATCH /busy-events/ev-1', NEW_EVENT)
    setupBusy({ draft: null, event: makeBusy(LONG) }, fake)
    await screen.findByRole('dialog', { name: s.busy.titleEdit })
    const what = screen.getByRole('textbox', { name: s.busy.what })
    await userEvent.clear(what)
    await userEvent.type(what, 'Trip north')
    await userEvent.click(screen.getByRole('button', { name: s.busy.saveEdit }))
    await waitFor(() => { expect(fake.calls('PATCH', '/busy-events/ev-1')).toHaveLength(1) })
    expect(fake.calls('PATCH', '/busy-events/ev-1')[0]?.body).toEqual({ title: 'Trip north' })
  })

  it('a time edit of an event over several days keeps its last day for the end', async () => {
    const fake = baseFake().on('PATCH /busy-events/ev-1', NEW_EVENT)
    setupBusy({ draft: null, event: makeBusy(LONG) }, fake)
    await screen.findByRole('dialog', { name: s.busy.titleEdit })
    const to = screen.getByRole('group', { name: s.busy.to })
    const hour = within(to).getAllByRole('spinbutton')[0] as HTMLElement
    await userEvent.click(hour)
    await userEvent.keyboard('{ArrowUp}')
    await userEvent.click(screen.getByRole('button', { name: s.busy.saveEdit }))
    await waitFor(() => { expect(fake.calls('PATCH', '/busy-events/ev-1')).toHaveLength(1) })
    expect(fake.calls('PATCH', '/busy-events/ev-1')[0]?.body).toEqual({
      starts_at: '2026-11-16T20:00:00.000Z',
      ends_at: '2026-11-18T07:00:00.000Z',
    })
  })
})

describe('CommitmentSheet', () => {
  it('titles with the commitment name as user text and links to settings', async () => {
    const onClose = vi.fn()
    renderBoard(<CommitmentSheet item={makeBusy({ title: 'עבודה' })} tz={TZ} onClose={onClose} />, { api: baseFake().api })
    const dialog = await screen.findByRole('dialog')
    expect(dialog.querySelector('[data-user-text]')?.textContent).toBe('עבודה')
    expect(within(dialog).getByRole('link', { name: en.calendar.sheets.commitment.edit })).toHaveAttribute('href', '/settings')
  })
})
