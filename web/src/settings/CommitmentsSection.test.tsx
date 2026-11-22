import { screen, waitFor, within } from '@testing-library/react'
import { userEvent, type UserEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Commitment, CommitmentInput, CommitmentPatch } from '../availability/types'
import { en } from '../i18n/en'
import { COMPLETED_AT, examFixture, meFixture, previewFixture } from '../test/onboardingFixtures'
import { createFakeApi, problem, type ApiCall, type FakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

const t = en.settingsScreen.busy
const dialog = en.commitments.dialog
const WORK = 'משמרת עבודה'
const LEGACY_ME_TIME = 'זמן לעצמי'

const row = (id: string, weekday: Commitment['weekday'], extra: Partial<Commitment> = {}): Commitment => ({
  id,
  title: WORK,
  kind: 'work',
  weekday,
  start_time: '14:00',
  end_time: '17:00',
  valid_from: '2026-11-01',
  valid_until: null,
  source_job_id: null,
  created_at: '2026-11-01T08:00:00Z',
  ...extra,
})

const meTime = (title: string) =>
  ([0, 1, 2, 3, 4, 5, 6] as const).map((d) =>
    row(`m${String(d)}`, d, { title, kind: 'other', start_time: '18:00', end_time: '19:00' }),
  )

// A server that keeps its commitments: a write changes what the next GET /commitments returns, and
// a created row gets a new id, as the API gives it. `fail` turns one call into a problem.
function server(initial: Commitment[], fail: (call: ApiCall) => boolean = () => false) {
  let store = [...initial]
  let next = 100
  const fake = createFakeApi()
    .on('GET /me', meFixture({ onboarding_completed_at: COMPLETED_AT }))
    .on('GET /exams', [examFixture()])
    .on('POST /plan/replan', previewFixture())
    .on('GET /commitments', () => ({ commitments: store }))
    .on('POST /commitments', (call: ApiCall) => {
      if (fail(call)) return problem(422, 'too_many_commitments')
      const body = call.body as CommitmentInput
      next += 1
      const created = row(`n${String(next)}`, body.weekday, {
        ...body,
        valid_from: body.valid_from ?? '2026-11-22',
        valid_until: body.valid_until ?? null,
      })
      store = [...store, created]
      return { commitment: created, plan_affected: true }
    })
    .on({ method: 'PATCH', path: /^\/commitments\// }, (call: ApiCall) => {
      if (fail(call)) return problem(500, 'internal_error')
      const id = call.path.split('/')[2] ?? ''
      store = store.map((c) => (c.id === id ? { ...c, ...(call.body as CommitmentPatch) } : c))
      return { commitment: store.find((c) => c.id === id), plan_affected: true }
    })
    .on({ method: 'DELETE', path: /^\/commitments\// }, (call: ApiCall) => {
      if (fail(call)) return problem(500, 'internal_error')
      const id = call.path.split('/')[2] ?? ''
      store = store.filter((c) => c.id !== id)
      return { plan_affected: true }
    })
  return fake
}

function open(fake: FakeApi) {
  renderRoute('/settings', { auth: createFakeAuth(fakeSession({ id: 'user-a' })), api: fake.api })
  return userEvent.setup()
}

function card() {
  return screen.getByRole('region', { name: t.title })
}

async function ready() {
  await screen.findByRole('heading', { level: 2, name: t.title })
}

async function typeTime(user: UserEvent, label: string, time: string) {
  const [hour] = within(screen.getByRole('group', { name: label })).getAllByRole('spinbutton') as [HTMLElement]
  await user.click(hour)
  await user.keyboard(time.replace(':', ''))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CommitmentsSection', () => {
  it('shows a group of two days as one row, and leaves Me time out', async () => {
    open(server([row('c0', 0), row('c2', 2), ...meTime('Me time')]))
    await ready()
    const rows = await within(card()).findAllByRole('button', { name: new RegExp(WORK) })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Sun, Tue, 14:00–17:00')
    expect(within(card()).queryByText('Me time')).not.toBeInTheDocument()
    expect(within(card()).queryByText(en.commitments.everyDay, { exact: false })).not.toBeInTheDocument()
  })

  it('leaves out the Me time of a veteran user with the legacy title, and shows the empty sentence', async () => {
    open(server(meTime(LEGACY_ME_TIME)))
    await ready()
    expect(await within(card()).findByText(t.empty)).toBeInTheDocument()
    expect(t.empty).toBe('Nothing here yet. Add your work, classes or other fixed hours, and I’ll schedule around them.')
    expect(within(card()).queryByText(LEGACY_ME_TIME)).not.toBeInTheDocument()
  })

  it('keeps a seven-day Me time that is not the Me time set (a second, newer one) in Busy time', async () => {
    const newer = meTime('Me time').map((c) => ({
      ...c,
      id: `x${c.id}`,
      start_time: '07:00',
      end_time: '08:00',
      created_at: '2026-11-10T08:00:00Z',
    }))
    open(server([...meTime('Me time'), ...newer]))
    await ready()
    const rows = await within(card()).findAllByRole('button', { name: /Me time/ })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent(`${en.commitments.everyDay}, 07:00–08:00`)
  })

  it('places the section after Study preferences and before Reminders', async () => {
    open(server([]))
    await ready()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    const busy = headings.indexOf(t.title)
    expect(busy).toBeGreaterThan(headings.indexOf(en.settings.preferences.title))
    expect(busy).toBeLessThan(headings.indexOf(en.notifications.title))
  })

  it('"Add" opens the dialog, and a save with plan_affected offers a replan', async () => {
    const fake = server([])
    const user = open(fake)
    await ready()
    await user.click(within(card()).getByRole('button', { name: t.add }))
    expect(screen.getByRole('heading', { name: dialog.titleAdd })).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: dialog.name }), WORK)
    await user.click(screen.getByRole('checkbox', { name: en.commitments.weekdayLong[0] }))
    await typeTime(user, dialog.from, '14:00')
    await typeTime(user, dialog.to, '17:00')
    await user.click(screen.getByRole('button', { name: en.common.save }))

    expect(await screen.findByRole('heading', { name: en.replan.title })).toBeInTheDocument()
    expect(screen.getByText(t.replanReason)).toBeInTheDocument()
    expect(fake.calls('POST', '/commitments')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: en.replan.notNow }))
    expect(await within(card()).findByRole('button', { name: new RegExp(WORK) })).toHaveTextContent('Sun, 14:00–17:00')
  })

  it('a delete shows a toast with Undo, and Undo recreates every day of the group', async () => {
    const fake = server([row('c0', 0, { valid_until: '2027-01-10' }), row('c2', 2, { valid_until: '2027-01-10' })])
    const user = open(fake)
    await ready()
    await user.click(await within(card()).findByRole('button', { name: new RegExp(WORK) }))
    await user.click(screen.getByRole('button', { name: en.common.delete }))

    expect(await screen.findByText(t.removed)).toBeInTheDocument()
    expect(t.removed).toBe('Busy time removed')
    expect(fake.calls('DELETE').map((c) => c.path)).toEqual(['/commitments/c0', '/commitments/c2'])
    expect(await within(card()).findByText(t.empty)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: en.common.undo }))

    const recreated = await within(card()).findByRole('button', { name: new RegExp(WORK) })
    expect(recreated).toHaveTextContent('Sun, Tue, 14:00–17:00')
    expect(fake.calls('POST', '/commitments').map((c) => c.body)).toEqual([
      { title: WORK, kind: 'work', weekday: 0, start_time: '14:00', end_time: '17:00', valid_from: '2026-11-01', valid_until: '2027-01-10' },
      { title: WORK, kind: 'work', weekday: 2, start_time: '14:00', end_time: '17:00', valid_from: '2026-11-01', valid_until: '2027-01-10' },
    ])
    // Undo put things back as they were: nothing to replan.
    expect(screen.queryByRole('heading', { name: en.replan.title })).not.toBeInTheDocument()
  })

  it('a delete that stands (the toast closes without Undo) offers a replan', async () => {
    const user = open(server([row('c0', 0)]))
    await ready()
    await user.click(await within(card()).findByRole('button', { name: new RegExp(WORK) }))
    await user.click(screen.getByRole('button', { name: en.common.delete }))
    await screen.findByText(t.removed)
    const toasts = screen.getByRole('region', { name: en.common.notifications })
    await user.click(within(toasts).getByRole('button', { name: en.common.close }))

    expect(await screen.findByRole('heading', { name: en.replan.title })).toBeInTheDocument()
  })

  it('an Undo that fails part way refreshes the list and says so', async () => {
    let posts = 0
    const fake = server([row('c0', 0), row('c2', 2)], (call) => {
      if (call.method !== 'POST' || call.path !== '/commitments') return false
      posts += 1
      return posts === 2
    })
    const user = open(fake)
    await ready()
    await user.click(await within(card()).findByRole('button', { name: new RegExp(WORK) }))
    await user.click(screen.getByRole('button', { name: en.common.delete }))
    await user.click(await screen.findByRole('button', { name: en.common.undo }))

    expect(await screen.findByText(t.undoFailed)).toBeInTheDocument()
    expect(await within(card()).findByRole('button', { name: new RegExp(WORK) })).toHaveTextContent('Sun, 14:00–17:00')
  })

  it('an edit where one request failed refreshes the list, shows a message, and offers a replan', async () => {
    const fake = server([row('c0', 0), row('c2', 2)], (call) => call.method === 'DELETE' && call.path === '/commitments/c2')
    const user = open(fake)
    await ready()
    await user.click(await within(card()).findByRole('button', { name: new RegExp(WORK) }))
    const name = screen.getByRole('textbox', { name: dialog.name })
    await user.clear(name)
    await user.type(name, 'משמרת ערב')
    await user.click(screen.getByRole('checkbox', { name: en.commitments.weekdayLong[2] }))
    await user.click(screen.getByRole('button', { name: en.common.save }))

    expect(await screen.findByText(dialog.saveFailed)).toBeInTheDocument()
    expect(fake.calls('PATCH').map((c) => c.path)).toEqual(['/commitments/c0'])
    // The list behind the (modal) dialog shows what the server holds now: the renamed Sunday and the
    // Tuesday, which is still there.
    const behind = screen.getByRole('region', { name: t.title, hidden: true })
    await waitFor(() => {
      expect(within(behind).getAllByRole('button', { name: /משמרת/, hidden: true })).toHaveLength(2)
    })
    expect(within(behind).getByRole('button', { name: /משמרת ערב/, hidden: true })).toHaveTextContent('Sun, 14:00–17:00')

    await user.click(screen.getByRole('button', { name: en.common.cancel }))
    expect(await screen.findByRole('heading', { name: en.replan.title })).toBeInTheDocument()
  })

  it('an edit that writes nothing offers no replan', async () => {
    const fake = server([row('c0', 0)])
    const user = open(fake)
    await ready()
    await user.click(await within(card()).findByRole('button', { name: new RegExp(WORK) }))
    await user.click(screen.getByRole('button', { name: en.common.save }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: dialog.titleEdit })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: en.replan.title })).not.toBeInTheDocument()
    expect(fake.calls().filter((c) => c.method !== 'GET')).toHaveLength(0)
  })

  it('"Update from a photo of my timetable" opens the import, and its busy times offer a replan', async () => {
    const fake = server([])
      .on('POST /timetables', { job_id: 'j1' })
      .on('GET /jobs/j1', {
        id: 'j1',
        kind: 'parse_timetable',
        status: 'done',
        stage: null,
        percent: null,
        error: null,
        result: { commitments: [{ title: WORK, kind: 'work', weekday: 1, start: '14:00', end: '17:00' }], model: 'claude' },
        created_at: '2026-11-18T08:00:00Z',
        started_at: null,
        finished_at: null,
      })
      .on('POST /timetables/j1/apply', { commitments: [row('t1', 1)], plan_affected: true })
    const user = open(fake)
    await ready()
    expect(await within(card()).findByRole('button', { name: en.commitments.timetable.uploadRow })).toBeInTheDocument()
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')
    if (input === null) throw new Error('no file input')
    await user.upload(input, new File([new Uint8Array(2000)], 'מערכת.pdf', { type: 'application/pdf' }))

    expect(await within(card()).findByText(en.commitments.timetable.found(1))).toBeInTheDocument()
    await user.click(within(card()).getByRole('button', { name: en.commitments.timetable.addIt }))
    expect(await screen.findByRole('heading', { name: en.replan.title })).toBeInTheDocument()
    expect(fake.calls('POST', '/timetables/j1/apply')).toHaveLength(1)
  })

  it('gives each row a short response to the pointer only where motion is welcome', async () => {
    open(server([row('c0', 0)]))
    await ready()
    const button = await within(card()).findByRole('button', { name: new RegExp(WORK) })
    const classes = button.className.split(/\s+/)
    expect(classes.some((c) => c.startsWith('motion-safe:transition'))).toBe(true)
    expect(classes.filter((c) => /^(transition|duration|animate)/.test(c))).toEqual([])
  })
})
