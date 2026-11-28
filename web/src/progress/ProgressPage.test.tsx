import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeArchived } from '../garden/testFixtures'
import { isolate } from '../i18n/bidi'
import { en } from '../i18n/en'
import { taskFixture } from '../test/examFixtures'
import { examFixture } from '../test/onboardingFixtures'
import { createFakeApi, problem } from '../test/fakeApi'
import { USER_ID, makeMe, renderBoard } from '../test/boardFixtures'
import { ProgressPage } from './ProgressPage'
import { makeBadges, makeProgress, newUserProgress } from './testFixtures'
import type { ArchivedExam, Progress } from './types'

const t = en.progress

// Jerusalem, so 2026-11-12T22:30Z is the 13th there.
function setup(progress: Progress | Error) {
  const fake = createFakeApi().on('GET /me', makeMe('Asia/Jerusalem')).on('GET /progress', progress)
  const view = renderBoard(<ProgressPage />, { api: fake.api })
  return { fake, ...view }
}

function section(name: string) {
  return screen.getByRole('region', { name })
}

// A badge is a row of the list of its group; its name is plain text, not a heading.
function badgeItem(name: string) {
  const badges = screen.getByRole('region', { name: t.badges.title })
  const item = within(badges).getByText(name).closest('li')
  if (item === null) throw new Error(`no badge ${name}`)
  return item
}

describe('the progress board', () => {
  // Only Date is frozen (the screen's data carries its own dates); timers keep running for the queries.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-16T10:00:00Z') })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the level, the total XP, the blocks done and the streak', async () => {
    setup(makeProgress())
    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeInTheDocument()
    const level = await screen.findByRole('region', { name: t.level.title })
    expect(within(level).getByText(t.level.level(2))).toBeInTheDocument()
    expect(within(level).getByText(t.level.totalXp('1,240'))).toBeInTheDocument()
    // The ring says how far along the level is, once: no second sentence with what is left.
    expect(within(level).getByText(t.level.barValue('240', '1,000'))).toBeInTheDocument()
    expect(within(level).queryByText(/760 (left|more|to go)/i)).not.toBeInTheDocument()
    expect(within(level).getByText(t.level.blocksDone(12))).toBeInTheDocument()

    const streak = section(t.streak.title)
    expect(within(streak).getByText(t.streak.days(4))).toBeInTheDocument()
    expect(within(streak).getByText(t.streak.studiedToday)).toBeInTheDocument()
    expect(within(streak).getByText(en.garden.streak.longest(t.streak.days(9)))).toBeInTheDocument()
    expect(screen.getByText(t.days.summary(5, 14))).toBeInTheDocument()
  })

  it('a streak of 0 after a longer one: Archi says it paused; with no history it is the invitation', async () => {
    const { unmount } = setup(makeProgress({ streak: { current: 0, longest: 3, studied_today: false, today: '2026-11-16' } }))
    const streak = await screen.findByRole('region', { name: t.streak.title })
    expect(within(streak).getByText(en.garden.streak.paused)).toBeInTheDocument()
    expect(streak.querySelector('[data-archi-says]')).not.toBeNull()
    expect(within(streak).queryByText(t.streak.start)).not.toBeInTheDocument()
    unmount()
    setup(makeProgress({ streak: { current: 0, longest: 0, studied_today: false, today: '2026-11-16' } }))
    const fresh = await screen.findByRole('region', { name: t.streak.title })
    expect(within(fresh).getByText(t.streak.start)).toBeInTheDocument()
    expect(fresh.querySelector('[data-archi-says]')).toBeNull()
  })

  it('the 14 leaves are a section after the two cards and before the badges', async () => {
    setup(makeProgress())
    const days = await screen.findByRole('heading', { level: 2, name: en.garden.days.title })
    const streak = section(t.streak.title)
    expect(streak).not.toContainElement(days)
    expect(streak.compareDocumentPosition(days) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const badges = section(t.badges.title)
    expect(days.compareDocumentPosition(badges) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const leaves = [...document.querySelectorAll('[data-day]')]
    expect(leaves).toHaveLength(14)
    expect(document.querySelectorAll('[data-day="studied"]')).toHaveLength(5)
    expect(document.querySelectorAll('[data-today]')).toHaveLength(1)
  })

  it('level 4 with 620 of 1,000 XP: the number, the words, and a ring that has the words as its name', async () => {
    setup(makeProgress({ total_xp: 3620, level: 4, level_start_xp: 3000, next_level_xp: 4000 }))
    const level = await screen.findByRole('region', { name: t.level.title })
    expect(within(level).getByText('Level 4')).toBeInTheDocument()
    expect(within(level).getByText('620 of 1,000 XP')).toBeInTheDocument()
    expect(within(level).getByRole('img', { name: '620 of 1,000 XP' })).toBeInTheDocument()
    expect(within(level).queryByRole('progressbar')).not.toBeInTheDocument()
    const arc = level.querySelector('[data-part="arc"]')
    expect(arc).toHaveAttribute('stroke-dasharray', '62.0 100')
  })

  it('a new user: level 1, 0 XP, and a streak of 0 is an invitation', async () => {
    setup(newUserProgress())
    expect(await screen.findByRole('img', { name: t.level.barValue('0', '1,000') })).toBeInTheDocument()
    expect(screen.getByText(t.level.level(1))).toBeInTheDocument()
    expect(screen.getByText(t.level.totalXp('0'))).toBeInTheDocument()
    expect(screen.getByText(t.level.blocksDone(0))).toBeInTheDocument()
    const streak = section(t.streak.title)
    expect(within(streak).getByText(t.streak.start)).toBeInTheDocument()
    expect(screen.getByText(t.days.summary(0, 14))).toBeInTheDocument()
    expect(screen.getByText(t.badges.summary(0, 18))).toBeInTheDocument()
    expect(screen.getAllByText(t.badges.notEarned)).toHaveLength(18)
  })

  it('a live streak not yet extended today says so without blame', async () => {
    setup(makeProgress({ streak: { current: 3, longest: 3, studied_today: false, today: '2026-11-16' } }))
    const streak = await screen.findByRole('region', { name: t.streak.title })
    expect(within(streak).getByText(t.streak.keepGoing)).toBeInTheDocument()
  })

  it('at level 50 there is no next target', async () => {
    setup(
      makeProgress({
        total_xp: 1_300_000,
        level: 50,
        level_start_xp: 1_250_000,
        next_level_xp: null,
        badges: makeBadges({ knowledge_seeker_50: '2026-11-15T08:00:00Z' }),
      }),
    )
    const level = await screen.findByRole('region', { name: t.level.title })
    expect(within(level).getByText(t.level.level(50))).toBeInTheDocument()
    expect(within(level).getByText(t.level.max)).toBeInTheDocument()
    expect(within(level).getByText(t.level.totalXp('1,300,000'))).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(level).queryByRole('img')).toBeInTheDocument()
  })

  it('badges by group: earned ones with the date, the others say so in text with the way there', async () => {
    setup(makeProgress())
    const badges = await screen.findByRole('region', { name: t.badges.title })
    expect(within(badges).getByText(t.badges.summary(4, 18))).toBeInTheDocument()
    for (const group of Object.values(t.badges.groups)) {
      expect(within(badges).getByRole('heading', { level: 3, name: group })).toBeInTheDocument()
    }

    // 22:30 UTC on the 12th is the 13th in Jerusalem.
    const week = badgeItem(t.badges.items.iron_will_7.name)
    expect(week).toHaveTextContent(t.badges.earnedOn('13 Nov'))
    expect(week).not.toHaveTextContent(t.badges.notEarned)

    const twenty = badgeItem(t.badges.items.task_master_20.name)
    expect(twenty).toHaveTextContent(t.badges.notEarned)
    // The name already says it: the description is not repeated in the tile.
    expect(twenty).not.toHaveTextContent(t.badges.items.task_master_20.description)
    expect(twenty).toHaveTextContent(t.badges.towards('12', '20'))
  })

  // Fix wave 15: a badge the web has no name for yet (a newer server) still comes from
  // progress.badges, so its stone has its real tier: the fifth of five in its group.
  it('a badge from a newer server has its real tier in its group', async () => {
    const newer = { key: 'task_master_200', group: 'blocks' as const, threshold: 200, earned: true, earned_at: '2026-11-15T10:00:00Z' }
    setup(makeProgress({ blocks_done: 210, badges: [...makeBadges({ task_master_10: '2026-11-01T10:00:00Z' }), newer] }))
    await screen.findByRole('region', { name: t.badges.title })
    const tile = badgeItem(t.badges.unknown.name)
    expect(tile.querySelectorAll('[data-dot]')).toHaveLength(5)
    expect(tile.querySelectorAll('[data-dot="filled"]')).toHaveLength(5)
  })

  it('a badge not earned shows how far along it is', async () => {
    setup(makeProgress())
    await screen.findByRole('region', { name: t.badges.title })
    expect(badgeItem(t.badges.items.task_master_50.name)).toHaveTextContent(t.badges.towards('12', '50'))
    expect(badgeItem(t.badges.items.iron_will_10.name)).toHaveTextContent(t.badges.towards('9', '10'))
    expect(badgeItem(t.badges.items.knowledge_seeker_5.name)).toHaveTextContent(t.badges.towards('2', '5'))
    expect(badgeItem(t.badges.items.xp_5000.name)).toHaveTextContent(t.badges.towards('1,240', '5,000'))
  })

  it('an error shows the message and a retry that asks again', async () => {
    const user = userEvent.setup()
    const { fake } = setup(problem(503, 'unavailable'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fake.on('GET /progress', makeProgress())
    await user.click(screen.getByRole('button', { name: en.common.retry }))
    expect(await screen.findByText(t.level.level(2))).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows loading until the answer arrives', () => {
    const fake = createFakeApi().on('GET /me', makeMe()).on('GET /progress', new Promise(() => undefined))
    renderBoard(<ProgressPage />, { api: fake.api })
    expect(screen.getByRole('status')).toHaveTextContent(en.common.loading)
  })

  it('the title of the screen is there while loading, for the focus after a navigation', () => {
    const fake = createFakeApi().on('GET /me', makeMe()).on('GET /progress', new Promise(() => undefined))
    renderBoard(<ProgressPage />, { api: fake.api })
    expect(screen.getByRole('heading', { level: 1, name: t.title })).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('earned or not is said by the icon and the words, not by colour', async () => {
    setup(makeProgress())
    await screen.findByRole('region', { name: t.badges.title })
    const earned = badgeItem(t.badges.items.first_task.name)
    expect(earned).not.toHaveClass('border-dashed')
    const open = badgeItem(t.badges.items.task_master_100.name)
    expect(open).toHaveClass('border-dashed')
    expect(within(open).getByText(t.badges.notEarned)).toBeInTheDocument()
  })

  it('18 tiles in five groups, each with a stone', async () => {
    setup(makeProgress())
    const badges = await screen.findByRole('region', { name: t.badges.title })
    expect(within(badges).getAllByRole('list')).toHaveLength(5)
    expect(within(badges).getAllByRole('listitem')).toHaveLength(18)
    expect(badges.querySelectorAll('svg[data-group]')).toHaveLength(18)
    expect(within(badges).getAllByText(t.badges.notEarned)).toHaveLength(14)
  })

  it('each group of badges is a named list of tiles', async () => {
    setup(makeProgress())
    const badges = await screen.findByRole('region', { name: t.badges.title })
    const streak = within(badges).getByRole('list', { name: t.badges.groups.streak })
    expect(within(streak).getAllByRole('listitem')).toHaveLength(5)
  })

  it('asks again when the board key is invalidated, as every block action does', async () => {
    const { fake, queryClient } = setup(makeProgress())
    await screen.findByText(t.level.level(2))
    fake.on('GET /progress', makeProgress({ total_xp: 2100, level: 3, level_start_xp: 2000, next_level_xp: 3000 }))
    await queryClient.invalidateQueries({ queryKey: ['board', USER_ID] })
    expect(await screen.findByText(t.level.level(3))).toBeInTheDocument()
    await waitFor(() => {
      expect(fake.calls('GET', '/progress')).toHaveLength(2)
    })
  })

  describe('the archive', () => {
    const closed = en.closure.progress
    function archived(overrides: Partial<ArchivedExam> = {}): ArchivedExam {
      return {
        exam_id: 'exam-1',
        name: 'הסתברות',
        color_index: 2,
        exam_date: '2026-11-23',
        first_exam_date: null,
        sitting: 1,
        closed_at: '2026-11-16T10:00:00Z',
        studied_minutes: 1260,
        tasks_done: 14,
        tasks_total: 17,
        completion_percent: 86,
        ...overrides,
      }
    }

    it('without an archive there is no Archive heading', async () => {
      setup(makeProgress())
      await screen.findByRole('region', { name: t.badges.title })
      expect(screen.queryByRole('heading', { level: 2, name: closed.title })).not.toBeInTheDocument()
    })

    it('lists the exams in the server order, each a link to its exam', async () => {
      setup(
        makeProgress({
          archive: [
            archived(),
            archived({ exam_id: 'exam-2', name: 'Algorithms', closed_at: null, exam_date: '2026-11-20', sitting: 2, studied_minutes: 600, completion_percent: 70 }),
          ],
        }),
      )
      expect(await screen.findByRole('heading', { level: 2, name: closed.title })).toBeInTheDocument()
      const list = screen.getByRole('list', { name: closed.title })
      const [first, second, ...rest] = within(list).getAllByRole('listitem')
      if (first === undefined || second === undefined) throw new Error('two rows expected')
      expect(rest).toHaveLength(0)
      expect(within(first).getByRole('link', { name: 'הסתברות' })).toHaveAttribute('href', '/exams/exam-1')
      expect(within(first).getByText('Closed on 16 November 2026')).toBeInTheDocument()
      expect(within(first).getByText('21 hours studied, 86% of the plan')).toBeInTheDocument()
      expect(within(second).getByRole('link', { name: 'Algorithms' })).toHaveAttribute('href', '/exams/exam-2')
      expect(within(second).getByText('Retake. Closed on 20 November 2026')).toBeInTheDocument()
    })

    it('the day of the closure is the profile’s day, not UTC’s', async () => {
      setup(makeProgress({ archive: [archived({ closed_at: '2026-11-12T22:30:00Z' })] }))
      const list = await screen.findByRole('list', { name: closed.title })
      expect(within(list).getByText('Closed on 13 November 2026')).toBeInTheDocument()
    })

    it('a name that ends in a number is the student’s text, isolated with its own direction', async () => {
      setup(makeProgress({ archive: [archived({ name: 'חדו״א 1' })] }))
      const list = await screen.findByRole('list', { name: closed.title })
      const link = within(list).getByRole('link', { name: 'חדו״א 1' })
      const name = within(link).getByText('חדו״א 1')
      // The same element as the exams list (UserText): <bdi dir="auto">, so the digit stays at the end.
      expect(name.tagName).toBe('BDI')
      expect(name).toHaveAttribute('dir', 'auto')
      expect(name).toHaveAttribute('data-user-text')
    })
  })

  describe('the garden', () => {
    const g = en.garden
    afterEach(() => {
      vi.useRealTimers()
    })

    function withGarden(progress: Progress) {
      const fake = createFakeApi()
        .on('GET /me', makeMe('Asia/Jerusalem'))
        .on('GET /progress', progress)
        .on('GET /exams', [examFixture({ id: 'exam-a', name: 'Algorithms', exam_date: '2026-12-20' })])
        .on({ method: 'GET', path: /^\/exams\/[^/]+\/tasks$/ }, [
          taskFixture({ id: 't1', exam_id: 'exam-a', estimated_minutes: 62, status: 'done' }),
          taskFixture({ id: 't2', exam_id: 'exam-a', estimated_minutes: 38 }),
        ])
      return { fake, ...renderBoard(<ProgressPage />, { api: fake.api }) }
    }

    it('comes first, under the title and above the cards', async () => {
      setup(makeProgress())
      const garden = await screen.findByRole('region', { name: g.scene.title })
      const level = screen.getByRole('region', { name: t.level.title })
      const title = screen.getByRole('heading', { level: 1, name: t.title })
      expect(title.compareDocumentPosition(garden) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(garden.compareDocumentPosition(level) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('while loading, the garden has a card in its place that announces nothing more', () => {
      const fake = createFakeApi().on('GET /me', makeMe()).on('GET /progress', new Promise(() => undefined))
      const { container } = renderBoard(<ProgressPage />, { api: fake.api })
      expect(container.querySelectorAll('[data-skeleton-card]')).toHaveLength(2)
      expect(screen.getAllByRole('status')).toHaveLength(1)
    })

    it('Tab goes through the centre, the plants, the stones, the flowers, each once, then on', async () => {
      const user = userEvent.setup()
      withGarden(makeProgress({ archive: [makeArchived({ exam_id: 'exam-c', name: 'Calculus' })] }))
      const garden = await screen.findByRole('region', { name: g.scene.title })
      await within(garden).findByRole('button', { name: isolate('Algorithms') })

      const items = [...garden.querySelectorAll<SVGGElement>('[role="button"]')].map((el) => el.dataset.item)
      const kinds = items.map((item) => item?.split(':')[0])
      expect(kinds).toEqual(['tree', 'plant', 'plant', 'stone', 'stone', 'stone', 'stone', 'flowers'])

      const reached: (string | undefined)[] = []
      for (let i = 0; i < 40 && reached.length <= items.length; i++) {
        await user.tab()
        const active = document.activeElement
        if (active instanceof SVGElement && garden.contains(active)) reached.push(active.dataset.item)
        else if (reached.length > 0) break
      }
      expect(reached).toEqual(items)
      expect(garden.contains(document.activeElement)).toBe(false)
    })

    it('a refresh of GET /progress does not play the opening again', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.setSystemTime(new Date('2026-11-16T10:00:00Z'))
      const { container, fake, queryClient } = withGarden(makeProgress())
      await screen.findByRole('region', { name: g.scene.title })
      expect(container.querySelector('.garden-sway')).not.toBeNull()
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(container.querySelector('.garden-sway')).toBeNull()

      fake.on('GET /progress', makeProgress({ total_xp: 1350 }))
      await queryClient.invalidateQueries({ queryKey: ['board', USER_ID] })
      await waitFor(() => {
        expect(fake.calls('GET', '/progress')).toHaveLength(2)
      })
      expect(screen.getByRole('region', { name: g.scene.title })).toBeInTheDocument()
      expect(container.querySelector('.garden-sway')).toBeNull()
    })
  })
})
