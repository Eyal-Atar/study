import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { durationText } from '../board/time'
import { longDate } from '../exam/dates'
import { makeArchived } from '../garden/testFixtures'
import { isolate } from '../i18n/bidi'
import { en } from '../i18n/en'
import { makeMe, renderBoard } from '../test/boardFixtures'
import { taskFixture } from '../test/examFixtures'
import { createFakeApi, problem, type FakeApi } from '../test/fakeApi'
import { examFixture } from '../test/onboardingFixtures'
import { GardenCard } from './GardenCard'
import { SWAY_MS } from '../garden/GardenScene'
import { makeBadges, makeProgress } from './testFixtures'
import type { Progress } from './types'

// The garden on the progress screen (S33, Task 7): three sources (GET /progress, GET /exams and the
// tasks of each exam), the caption that tells the story of what is selected, and the keyboard.

const g = en.garden

// An active exam at 62% (62 of 100 minutes done) and one exam in the archive, closed on
// 2026-11-12T15:00Z (the 12th in Jerusalem) after 600 minutes of study.
const ACTIVE = examFixture({ id: 'exam-a', name: 'Algorithms', exam_date: '2026-12-20', color_index: 1 })
const CLOSED = makeArchived()
const TASKS = [
  taskFixture({ id: 't1', exam_id: 'exam-a', estimated_minutes: 62, status: 'done' }),
  taskFixture({ id: 't2', exam_id: 'exam-a', estimated_minutes: 38, status: 'todo' }),
]

function server({ exams = [ACTIVE], tasks = TASKS }: { exams?: unknown; tasks?: unknown } = {}): FakeApi {
  return createFakeApi()
    .on('GET /me', makeMe('Asia/Jerusalem'))
    .on('GET /exams', exams)
    .on({ method: 'GET', path: /^\/exams\/[^/]+\/tasks$/ }, tasks)
}

function setup(fake: FakeApi = server(), progress: Progress = makeProgress({ archive: [CLOSED] })) {
  return { fake, ...renderBoard(<GardenCard progress={progress} />, { api: fake.api }) }
}

const garden = () => screen.getByRole('region', { name: g.scene.title })
const caption = () => within(garden()).getByRole('status')
const plantButton = (name: string) => within(garden()).findByRole('button', { name: isolate(name) })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the garden card', () => {
  it('a plant per exam, and the caption tells the story of the one selected', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    setup()

    const active = await plantButton('Algorithms')
    const bloom = await plantButton('Calculus')
    expect(within(garden()).getAllByRole('button', { name: /Algorithms|Calculus/ })).toHaveLength(2)
    expect(caption()).toHaveTextContent(g.scene.hint)

    await user.click(active)
    expect(caption()).toHaveTextContent(g.story.plant('Algorithms', 62))
    expect(active).toHaveAttribute('aria-pressed', 'true')

    bloom.focus()
    await user.keyboard('{Enter}')
    expect(caption()).toHaveTextContent(g.story.bloom('Calculus', longDate('2026-11-12'), durationText(600)))
    expect(active).toHaveAttribute('aria-pressed', 'false')

    // The same thing again lets it go.
    await user.click(bloom)
    expect(caption()).toHaveTextContent(g.scene.hint)
    expect(bloom).toHaveAttribute('aria-pressed', 'false')
  })

  it('the tree and a stone have their stories too, the stone with its badge name', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    setup()
    await plantButton('Algorithms')

    await user.click(within(garden()).getByRole('button', { name: g.scene.stage.seed }))
    expect(caption()).toHaveTextContent(g.story.tree(g.scene.stage.seed, 2, 2, false))

    const week = en.progress.badges.items.iron_will_7.name
    await user.click(within(garden()).getByRole('button', { name: week }))
    // 22:30 UTC on the 12th is the 13th in Jerusalem.
    expect(caption()).toHaveTextContent(g.story.stone(week, longDate('2026-11-13')))
  })

  it('Escape in the scene lets the selection go', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    setup()
    const active = await plantButton('Algorithms')
    await user.click(active)
    expect(caption()).toHaveTextContent(g.story.plant('Algorithms', 62))

    await user.keyboard('{Escape}')
    expect(caption()).toHaveTextContent(g.scene.hint)
    expect(active).toHaveAttribute('aria-pressed', 'false')
  })

  it('the selected caption is the body text; the hint is small and muted', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    setup()
    const active = await plantButton('Algorithms')
    expect(caption()).toHaveClass('text-small', 'text-ink-muted')
    await user.click(active)
    expect(caption()).toHaveClass('text-body')
    expect(caption()).not.toHaveClass('text-ink-muted')
  })

  it('the scene is named by the summary, and the caption is its only live region', async () => {
    setup()
    await plantButton('Algorithms')
    const svg = garden().querySelector('svg')
    expect(svg).toHaveAttribute('role', 'group')
    expect(svg).toHaveAttribute('aria-label', g.scene.summary(g.scene.stage.seed, 2, 1, 4))
    expect(within(garden()).getByRole('heading', { level: 2, name: g.scene.title })).toHaveClass('sr-only')
    expect(garden().querySelectorAll('[role="status"], [role="alert"], [aria-live]')).toHaveLength(1)
  })

  it('while the tasks load there is only the archive, and no message', async () => {
    setup(server({ tasks: new Promise(() => undefined) }))
    expect(await plantButton('Calculus')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('region', { name: g.scene.title })).toBeInTheDocument()
    })
    expect(within(garden()).queryByRole('button', { name: isolate('Algorithms') })).not.toBeInTheDocument()
    expect(caption()).toHaveTextContent(g.scene.hint)
    expect(screen.queryByText(en.common.loading)).not.toBeInTheDocument()
  })

  it('GET /exams failing shows the garden with its archive, quietly', async () => {
    const { fake } = setup(server({ exams: problem(503, 'unavailable') }))
    expect(await plantButton('Calculus')).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/exams')).toHaveLength(1)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(within(garden()).getAllByRole('button', { name: /Calculus|Algorithms/ })).toHaveLength(1)
  })

  it('asks only for the exams and the tasks of the exams still open', async () => {
    const done = examFixture({ id: 'exam-closed', name: 'Calculus', state: 'done' })
    const { fake } = setup(server({ exams: [ACTIVE, done] }))
    await plantButton('Algorithms')
    expect(fake.calls('GET').map((c) => c.path).sort()).toEqual(['/exams', '/exams/exam-a/tasks', '/me'])
  })

  it('the centre sways once when the screen opens, not again later', async () => {
    const { container, fake } = setup()
    await plantButton('Algorithms')
    // The exams arriving re-render the scene; the motion that started goes on.
    expect(container.querySelector('.garden-sway')).not.toBeNull()
    expect(container.querySelector('.garden-leaf-fall')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(container.querySelector('.garden-sway')).toBeNull()
    expect(container.querySelector('.garden-leaf-fall')).toBeNull()
    expect(fake.calls('GET', '/me')).toHaveLength(1)
  })

  // Decision 11: the sway is 1,200ms, and the scene stops asking for it when the sway ends.
  it('the opening lasts exactly the sway, 1,200ms', () => {
    expect(SWAY_MS).toBe(1200)
    vi.useFakeTimers()
    const { container } = setup()
    expect(container.querySelector('.garden-sway')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(SWAY_MS - 1)
    })
    expect(container.querySelector('.garden-sway')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.querySelector('.garden-sway')).toBeNull()
  })

  // Decision 9: with nothing selected the caption is the garden's summary, then the hint.
  it('with nothing selected, the caption is the summary and then the hint', async () => {
    setup()
    await plantButton('Algorithms')
    expect(caption().textContent).toBe(`${g.scene.summary(g.scene.stage.seed, 2, 1, 4)} ${g.scene.hint}`)
  })

  // Fix wave 13: a selected thing that leaves the garden (a badge lost on undo, a refresh) is no
  // selection any more: the caption goes back to the summary and the hint, not a story.
  it('a selected thing that is no longer in the garden counts as nothing selected', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    const first = makeProgress({ archive: [CLOSED] })
    const holder: { set?: (p: Progress) => void } = {}
    function Holder() {
      const [progress, setProgress] = useState(first)
      holder.set = setProgress
      return <GardenCard progress={progress} />
    }
    renderBoard(<Holder />, { api: server().api })
    await plantButton('Algorithms')
    const week = en.progress.badges.items.iron_will_7.name
    await user.click(within(garden()).getByRole('button', { name: week }))
    expect(caption()).toHaveTextContent(week)

    const lost = makeProgress({ archive: [CLOSED], badges: makeBadges() })
    act(() => {
      holder.set?.(lost)
    })
    expect(within(garden()).queryByRole('button', { name: week })).not.toBeInTheDocument()
    expect(caption().textContent).toBe(`${g.scene.summary(g.scene.stage.seed, 2, 1, 0)} ${g.scene.hint}`)
    expect(caption()).toHaveClass('text-small', 'text-ink-muted')
  })
})
