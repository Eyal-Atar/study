import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blockName } from '../board/blockName'
import { durationText } from '../board/time'
import type { Block, CompleteResult } from '../board/types'
import { CAL_NOW, CAL_TODAY, openCalendar, stubMedia } from '../calendar/testFixtures'
import { en } from '../i18n/en'
import { progressKey } from '../progress/api'
import { makeBadges, makeProgress } from '../progress/testFixtures'
import type { Progress } from '../progress/types'
import { focusPath } from '../session/focusSession'
import { makeBlock, USER_ID } from '../test/boardFixtures'
import { makeClosureItem } from '../test/closureFixtures'
import { problem } from '../test/fakeApi'

// The celebration sheet in the calendar (S33 Task 9): one sheet for the moment a Done earned, timed
// against the calendar's other sheets. The clock is frozen at CAL_NOW (11:25 in Jerusalem, UTC+2).

const t = en.garden.celebrate
const MINUTE = 60_000

// Today, four blocks of an hour: three done, the last one running now (11:00–12:00).
const doneBlock = (id: string, hour: number): Block =>
  makeBlock({
    id,
    task_id: `t-${id}`,
    task_title: `Block ${id}`,
    study_date: CAL_TODAY,
    status: 'done',
    state: 'done',
    starts_at: `2026-11-24T0${String(hour)}:00:00Z`,
    ends_at: `2026-11-24T0${String(hour + 1)}:00:00Z`,
  })
const B1 = doneBlock('b1', 4)
const B2 = doneBlock('b2', 5)
const B3 = doneBlock('b3', 6)
const LAST = makeBlock({
  id: 'b-last',
  task_id: 't-last',
  task_title: 'Block last',
  study_date: CAL_TODAY,
  state: 'in_progress',
  starts_at: '2026-11-24T09:00:00Z',
  ends_at: '2026-11-24T10:00:00Z',
})
// Later today, still to come: with it the day is not complete.
const LATER = makeBlock({
  id: 'b-later',
  task_id: 't-later',
  task_title: 'Block later',
  study_date: CAL_TODAY,
  starts_at: '2026-11-24T12:00:00Z',
  ends_at: '2026-11-24T13:00:00Z',
})
// Tomorrow at 09:00 in Jerusalem.
const TOMORROW = makeBlock({
  id: 'b-tomorrow',
  task_id: 't-tomorrow',
  task_title: 'Block tomorrow',
  study_date: '2026-11-25',
  starts_at: '2026-11-25T07:00:00Z',
  ends_at: '2026-11-25T08:00:00Z',
})

const DAY = [B1, B2, B3, LAST, TOMORROW]

// 14 days up to today, 60 XP today.
function days(): Progress['days'] {
  return Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 10, 11 + i)).toISOString().slice(0, 10)
    return { date, xp: date === CAL_TODAY ? 60 : 0 }
  })
}

const PROGRESS = makeProgress({
  total_xp: 1240,
  level: 2,
  streak: { current: 4, longest: 9, studied_today: true, today: CAL_TODAY },
  days: days(),
  badges: makeBadges(),
})

interface Change {
  xp?: number
  total?: number
  level?: number
  levelUp?: boolean
  badges?: string[]
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// The calendar with a server whose complete and uncomplete follow `blocks`, and answer `change`.
async function open(blocks: Block[], change: Change = {}, path = '/calendar') {
  const opened = openCalendar(path, { blocks })
  const server = { change, answer: null as Promise<unknown> | null, progress: PROGRESS as Progress | Promise<Progress> | Error }
  opened.fake.on('GET /progress', () => server.progress)
  opened.fake.on({ method: 'POST', path: /^\/blocks\/[^/]+\/complete$/ }, (call: { path: string }) => {
    const id = call.path.split('/')[2]
    const original = blocks.find((b) => b.id === id) ?? LAST
    const done: Block = { ...original, status: 'done', state: 'done' }
    opened.state.blocks = opened.state.blocks.map((b) => (b.id === id ? done : b))
    const c = server.change
    const result: CompleteResult = {
      block: done,
      task_status: 'done',
      progress: {
        xp_change: c.xp ?? 20,
        total_xp: c.total ?? 1260,
        level: c.level ?? 2,
        level_up: c.levelUp ?? false,
        badges_earned: c.badges ?? [],
        badges_lost: [],
      },
    }
    return server.answer === null ? result : server.answer.then(() => result)
  })
  opened.fake.on({ method: 'POST', path: /^\/blocks\/[^/]+\/uncomplete$/ }, (call: { path: string }) => {
    const id = call.path.split('/')[2]
    const back: Block = { ...(blocks.find((b) => b.id === id) ?? LAST), status: 'planned', state: 'upcoming' }
    opened.state.blocks = opened.state.blocks.map((b) => (b.id === id ? back : b))
    return { block: back, task_status: 'todo' }
  })
  // GET /progress was asked for before the answer above was in place.
  await act(async () => {
    await opened.queryClient.invalidateQueries({ queryKey: progressKey(USER_ID) })
  })
  return { ...opened, server }
}

const celebration = (name: string) => screen.findByRole('dialog', { name })
const anyDialog = () => screen.queryByRole('dialog')

async function toasts() {
  return within(await screen.findByRole('region', { name: en.common.notifications }))
}

// The toast of the Done: the answer has arrived and the event has been sent.
async function doneToast() {
  await (await toasts()).findAllByText(new RegExp(en.board.completed))
}

async function settled() {
  await screen.findByRole('heading', { name: en.calendar.page.planHeading })
}

function doneButton(block: Block) {
  const button = screen.getAllByRole('button', { name: en.board.completeLabel(blockName(block)) })[0]
  if (button === undefined) throw new Error(`no Done for ${block.id}`)
  return button
}

async function clickDone(block: Block) {
  await waitFor(() => {
    expect(screen.getAllByRole('button', { name: en.board.completeLabel(blockName(block)) }).length).toBeGreaterThan(0)
  })
  await userEvent.click(doneButton(block))
}

function primaryClose(dialog: HTMLElement) {
  const primary = within(dialog)
    .getAllByRole('button', { name: t.close })
    .find((b) => b.textContent === t.close)
  if (primary === undefined) throw new Error('no primary Close')
  return primary
}

function at(instant: string | number) {
  vi.setSystemTime(new Date(instant))
}

let animate: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(CAL_NOW)
  animate = vi.fn(() => ({ finished: new Promise(() => undefined), cancel: vi.fn(), addEventListener: vi.fn() }))
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(Element.prototype, 'animate')
  window.localStorage.clear()
})

describe('the celebration sheet on a computer', () => {
  beforeEach(() => {
    stubMedia({ desktop: true })
  })

  it('Done on the last block of the day: the day sheet with its chips; Close; another Done that day: no sheet', async () => {
    await open(DAY)
    await settled()
    await clickDone(LAST)
    const sheet = await celebration(t.dayTitle)
    const inSheet = within(sheet)
    expect(inSheet.getByText(t.dayBody(4, durationText(240)))).toBeInTheDocument()
    expect(inSheet.getByText(t.tomorrow('09:00'))).toBeInTheDocument()
    expect(await inSheet.findByText(t.xpToday('60'))).toBeInTheDocument()
    expect(inSheet.getByText(t.streak(4))).toBeInTheDocument()
    // Only the day happened: no line of anything else.
    expect(inSheet.queryByText(t.alsoDay)).not.toBeInTheDocument()
    // The toast still says it all in words.
    await doneToast()

    await userEvent.click(primaryClose(sheet))
    await waitFor(() => {
      expect(anyDialog()).not.toBeInTheDocument()
    })
    // The focus came back to the page, not to nowhere.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body)
    })
    expect(document.activeElement?.closest('[role="dialog"]')).toBeNull()

    // Mark as not done, then Done again: the day was already celebrated on this device.
    await userEvent.click(screen.getAllByRole('button', { name: en.board.uncompleteLabel(blockName(B3)) })[0] as HTMLElement)
    await clickDone(B3)
    await waitFor(async () => {
      expect((await toasts()).getAllByText(new RegExp(en.board.completed)).length).toBeGreaterThan(0)
    })
    expect(anyDialog()).not.toBeInTheDocument()
  })

  it('a level up into a new stage leads, with Before and After, and a line for the day completed with it', async () => {
    await open(DAY, { level: 3, levelUp: true })
    await settled()
    await clickDone(LAST)
    const sheet = await celebration(t.stageTitle(en.garden.scene.stage.sprout))
    const inSheet = within(sheet)
    expect(inSheet.getByText(t.before)).toBeInTheDocument()
    expect(inSheet.getByText(t.after)).toBeInTheDocument()
    expect(inSheet.getByText(t.stageBody(3))).toBeInTheDocument()
    expect(inSheet.getByText(t.alsoDay)).toBeInTheDocument()
    expect(inSheet.getAllByRole('group')).toHaveLength(2)
    // The scene "after" enters; the hop is on Archi.
    expect(sheet.querySelector('.garden-enter')).not.toBeNull()
    expect(document.querySelector('.archie-hop')).not.toBeNull()
  })

  it('a level up in the same stage: the level sheet, whose ring fills', async () => {
    window.localStorage.setItem(`archi.celebrated.${USER_ID}`, JSON.stringify({ day: null, level: 3, badges: [] }))
    await open([LAST, LATER], { level: 4, levelUp: true })
    await settled()
    await clickDone(LAST)
    const sheet = await celebration(t.levelTitle(4))
    expect(within(sheet).getByText(t.levelBody(4))).toBeInTheDocument()
    const arc = sheet.querySelector('[data-part="arc"]')
    expect(arc).not.toBeNull()
    expect(animate.mock.contexts).toContain(arc)
  })

  it('a first badge: its name, its stone settling, and what it means', async () => {
    await open([LAST, LATER], { badges: ['first_task'] })
    await settled()
    await clickDone(LAST)
    const sheet = await celebration(en.progress.badges.items.first_task.name)
    expect(within(sheet).getByText(t.badgeBody)).toBeInTheDocument()
    expect(sheet.querySelector('.garden-settle')).not.toBeNull()
    // The day is not complete: no line for it.
    expect(within(sheet).queryByText(t.alsoDay)).not.toBeInTheDocument()
  })

  it('a badge the web does not know never shows "undefined"', async () => {
    await open(DAY, { badges: ['first_task', 'brand_new_badge'] })
    await settled()
    await clickDone(LAST)
    const sheet = await celebration(en.progress.badges.items.first_task.name)
    expect(sheet.textContent).not.toContain('undefined')
    expect(within(sheet).getByText(t.alsoDay)).toBeInTheDocument()
  })

  it('waits while the actions sheet is open, and opens once it closes', async () => {
    const { server } = await open(DAY)
    await settled()
    const answer = deferred<undefined>()
    server.answer = answer.promise
    // Done from the block's sheet closes that sheet; another block's sheet opens before the answer.
    await userEvent.click(
      await screen.findByRole('button', { name: en.calendar.grid.blockLabel(LAST.task_title, '11:00–12:00', LAST.exam_name, en.board.kinds.learn, en.board.states.in_progress, false) }),
    )
    const actions = await screen.findByRole('dialog', { name: en.calendar.sheets.actions.title })
    await userEvent.click(within(actions).getByRole('button', { name: en.board.completeLabel(blockName(LAST)) }))
    await waitFor(() => {
      expect(anyDialog()).not.toBeInTheDocument()
    })
    await userEvent.click(
      screen.getByRole('button', { name: en.calendar.grid.blockLabel(B1.task_title, '06:00–07:00', B1.exam_name, en.board.kinds.learn, en.board.states.done, false) }),
    )
    await screen.findByRole('dialog', { name: en.calendar.sheets.actions.title })
    await act(async () => {
      answer.resolve(undefined)
      await answer.promise
    })
    await doneToast()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByRole('dialog', { name: t.dayTitle })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(await celebration(t.dayTitle)).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('a closure that opens by itself goes first, and the celebration after it', async () => {
    const item = makeClosureItem({ opens_at: '2026-11-23T17:00:00Z' })
    const opened = await open(DAY, { level: 3, levelUp: true }, '/progress')
    opened.state.closures = { pending: [item], waiting: [] }
    // A Done that reached the inbox while the calendar was not on screen.
    opened.state.blocks = DAY.map((b) => (b.id === LAST.id ? { ...b, status: 'done' as const, state: 'done' as const } : b))
    const { emitCompleted } = await import('../board/xpEvents')
    act(() => {
      emitCompleted({ blockId: LAST.id, xp: 20, level: 3, levelUp: true, badgesEarned: [] })
    })
    await act(async () => {
      await opened.router.navigate('/calendar')
    })
    const closure = await screen.findByRole('dialog', { name: en.closure.sheet.title(item.exam_name) })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    const x = within(closure)
      .getAllByRole('button', { name: en.common.close })
      .find((b) => b.textContent !== en.common.close)
    await userEvent.click(x as HTMLElement)
    expect(await celebration(t.stageTitle(en.garden.scene.stage.sprout))).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

describe('the sheet says only what the server says', () => {
  beforeEach(() => {
    stubMedia({ desktop: true })
  })

  it('a level up waits for the refetch of GET /progress, and the ring shows the new level’s percent', async () => {
    window.localStorage.setItem(`archi.celebrated.${USER_ID}`, JSON.stringify({ day: null, level: 3, badges: [] }))
    // A real level up: the new total is past the old level's end (2000), so the patched cache is
    // level 4 with level 3's bounds until the refetch.
    const { server, fake } = await open([LAST, LATER], { level: 4, levelUp: true, total: 3600 })
    await settled()
    const fresh = deferred<Progress>()
    server.progress = fresh.promise
    const asked = fake.calls('GET', '/progress').length
    await clickDone(LAST)
    await doneToast()
    await waitFor(() => {
      expect(fake.calls('GET', '/progress').length).toBeGreaterThan(asked)
    })
    // The cache still has level 3's bounds: no sheet yet.
    expect(anyDialog()).not.toBeInTheDocument()
    await act(async () => {
      fresh.resolve({ ...PROGRESS, total_xp: 3600, level: 4, level_start_xp: 3000, next_level_xp: 4000 })
      await fresh.promise
    })
    const sheet = await celebration(t.levelTitle(4))
    expect(sheet.querySelector('[data-part="arc"]')).toHaveAttribute('stroke-dasharray', '60.0 100')
  })

  it('without GET /progress a new stage says the level’s words, not "before and after"', async () => {
    const { server, queryClient } = await open([LAST, LATER], { level: 3, levelUp: true })
    server.progress = problem(500, 'internal')
    await act(async () => {
      await queryClient.resetQueries({ queryKey: progressKey(USER_ID) })
    })
    await settled()
    await clickDone(LAST)
    const sheet = await celebration(t.stageTitle(en.garden.scene.stage.sprout))
    expect(within(sheet).queryByText(t.stageBody(3))).not.toBeInTheDocument()
    expect(within(sheet).queryByText(t.before)).not.toBeInTheDocument()
    expect(within(sheet).getByText(t.levelBody(3))).toBeInTheDocument()
  })
})

describe('the celebration sheet on a phone', () => {
  beforeEach(() => {
    stubMedia({ desktop: false })
  })

  it('waits while the tasks sheet is open', async () => {
    const { server } = await open(DAY)
    await settled()
    const answer = deferred<undefined>()
    server.answer = answer.promise
    await clickDone(LAST)
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(en.today.blocks) }))
    await screen.findByRole('dialog', { name: en.today.blocks })
    await act(async () => {
      answer.resolve(undefined)
      await answer.promise
    })
    await doneToast()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await userEvent.keyboard('{Escape}')
    expect(await celebration(t.dayTitle)).toBeInTheDocument()
  })

  it('the stage sheet asks the server nothing: no GET /exams, no tasks', async () => {
    const { fake } = await open(DAY, { level: 3, levelUp: true })
    await settled()
    const exams = fake.calls('GET', '/exams').length
    const tasks = fake.calls('GET', /^\/exams\/[^/]+\/tasks$/).length
    await clickDone(LAST)
    await doneToast()
    const before = await celebration(t.stageTitle(en.garden.scene.stage.sprout))
    expect(within(before).getAllByRole('group')).toHaveLength(2)
    // Any query the sheet observed would refetch on mount: give it the time to.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(fake.calls('GET', '/exams')).toHaveLength(exams)
    expect(fake.calls('GET', /^\/exams\/[^/]+\/tasks$/)).toHaveLength(tasks)
  })
})

describe('a Done away from the calendar', () => {
  beforeEach(() => {
    stubMedia({ desktop: true })
  })

  // Done on the focus screen goes back to the calendar at once; the answer arrives on another screen.
  async function doneInFocus() {
    window.localStorage.setItem(`archi.celebrated.${USER_ID}`, JSON.stringify({ day: null, level: 1, badges: [] }))
    const opened = await open(DAY, {}, focusPath(LAST.id))
    const answer = deferred<undefined>()
    opened.server.answer = answer.promise
    await userEvent.click(await screen.findByRole('button', { name: en.board.completeLabel(blockName(LAST)) }))
    await act(async () => {
      await opened.router.navigate('/progress')
    })
    await act(async () => {
      answer.resolve(undefined)
      await answer.promise
    })
    await doneToast()
    expect(anyDialog()).not.toBeInTheDocument()
    return opened
  }

  it('opens on the way back to the calendar', async () => {
    const { router } = await doneInFocus()
    await act(async () => {
      await router.navigate('/calendar')
    })
    expect(await celebration(t.dayTitle)).toBeInTheDocument()
  })

  it('not after 16 minutes', async () => {
    const { router, fake } = await doneInFocus()
    at(Date.parse(CAL_NOW) + 16 * MINUTE)
    const asked = fake.calls('GET', '/today').length
    await act(async () => {
      await router.navigate('/calendar')
    })
    await settled()
    await waitFor(() => {
      expect(fake.calls('GET', '/today').length).toBeGreaterThan(asked)
    })
    expect(anyDialog()).not.toBeInTheDocument()
  })
})

describe('with reduced motion', () => {
  beforeEach(() => {
    stubMedia({ desktop: true, reducedMotion: true })
  })

  it('no hop, no entering garden, no settling stone, and no Element.animate', async () => {
    await open(DAY, { level: 3, levelUp: true, badges: ['first_task'] })
    await settled()
    await clickDone(LAST)
    const sheet = await celebration(t.stageTitle(en.garden.scene.stage.sprout))
    expect(within(sheet).getByText(t.alsoBadges([en.progress.badges.items.first_task.name]))).toBeInTheDocument()
    expect(document.querySelector('.archie-hop')).toBeNull()
    expect(sheet.querySelector('.garden-enter')).toBeNull()
    expect(sheet.querySelector('.garden-settle')).toBeNull()
    expect(animate).not.toHaveBeenCalled()
  })

  it('the level ring is full at once', async () => {
    window.localStorage.setItem(`archi.celebrated.${USER_ID}`, JSON.stringify({ day: null, level: 3, badges: [] }))
    await open([LAST, LATER], { level: 4, levelUp: true })
    await settled()
    await clickDone(LAST)
    const sheet = await celebration(t.levelTitle(4))
    expect(sheet.querySelector('[data-part="arc"]')).not.toBeNull()
    expect(animate).not.toHaveBeenCalled()
  })
})
