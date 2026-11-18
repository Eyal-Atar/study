import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { formatDay } from '../board/time'
import { he } from '../i18n/he'
import { makeBlock, makeMe, makePlan, makeToday } from '../test/boardFixtures'
import { createFakeApi } from '../test/fakeApi'
import { createFakeAuth, fakeSession } from '../test/fakeAuth'
import { renderRoute } from '../test/renderRoute'

const TODAY = '2026-11-18'

// A signed-in user with a plan on `path`, with a day and a week to show.
function open(path: string) {
  const api = createFakeApi()
    .on('GET /me', makeMe())
    .on('GET /today', makeToday([makeBlock({ study_date: TODAY })], { date: TODAY }))
    .on({ method: 'GET', path: /^\/plan\?/ }, (call: { path: string }) => {
      const params = new URLSearchParams(call.path.slice(call.path.indexOf('?') + 1))
      return makePlan([], { from: params.get('from') ?? '', to: params.get('to') ?? '' })
    }).api
  return renderRoute(path, { auth: createFakeAuth(fakeSession()), api })
}

function viewSwitch() {
  return screen.findByRole('radiogroup', { name: he.calendar.view })
}

function option(name: string) {
  return within(screen.getByRole('radiogroup', { name: he.calendar.view })).getByRole('radio', { name })
}

describe('the calendar (S31, temporary)', () => {
  it('without ?view= shows the day, with "day" chosen', async () => {
    open('/calendar')

    expect(await screen.findByRole('heading', { level: 1, name: he.today.title })).toBeInTheDocument()
    await viewSwitch()
    expect(option(he.calendar.day)).toBeChecked()
    expect(option(he.calendar.week)).not.toBeChecked()
  })

  it('choosing "week" with the mouse moves to ?view=week and shows the week, and the focus stays on the switch', async () => {
    const user = userEvent.setup()
    const { router } = open('/calendar')
    await viewSwitch()

    await user.click(option(he.calendar.week))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=week')
    })
    expect(await screen.findByRole('heading', { level: 1, name: he.week.title })).toBeInTheDocument()
    expect(option(he.calendar.week)).toBeChecked()
    expect(option(he.calendar.week)).toHaveFocus()
  })

  it('the switch works from the keyboard: one Tab stop, an arrow moves, Space chooses', async () => {
    const user = userEvent.setup()
    const { router } = open('/calendar')
    await viewSwitch()

    option(he.calendar.day).focus()
    // RTL: the next option is to the left.
    await user.keyboard('{ArrowLeft}')
    expect(option(he.calendar.week)).toHaveFocus()
    await user.keyboard(' ')
    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=week')
    })
    expect(await screen.findByRole('heading', { level: 1, name: he.week.title })).toBeInTheDocument()
    expect(option(he.calendar.week)).toHaveFocus()

    await user.keyboard('{ArrowRight} ')
    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
    expect(await screen.findByRole('heading', { level: 1, name: he.today.title })).toBeInTheDocument()
    expect(option(he.calendar.day)).toHaveFocus()
  })

  it('?view=week&from= keeps from, and going back to the day drops it', async () => {
    const user = userEvent.setup()
    const { router } = open('/calendar?view=week&from=2026-12-02')

    expect(await screen.findByRole('heading', { level: 1, name: he.week.title })).toBeInTheDocument()
    expect(await screen.findByText(he.week.range(formatDay('2026-11-29'), formatDay('2026-12-05')))).toBeInTheDocument()
    expect(router.state.location.search).toBe('?view=week&from=2026-12-02')

    await user.click(option(he.calendar.day))
    await waitFor(() => {
      expect(router.state.location.search).toBe('')
    })
    expect(await screen.findByRole('heading', { level: 1, name: he.today.title })).toBeInTheDocument()
  })

  it('an unknown ?view= shows the day', async () => {
    open('/calendar?view=nonsense')

    expect(await screen.findByRole('heading', { level: 1, name: he.today.title })).toBeInTheDocument()
    await viewSwitch()
    expect(option(he.calendar.day)).toBeChecked()
  })

  // "יומן" in the navigation while the week is on screen asks for the day (S31 decision 30): one
  // new entry for the day, and not the week put back over it. A second press on the day replaces
  // its own entry, so one step back is the week.
  it('"יומן" in the navigation, from the week, lands on the day without a second history entry', async () => {
    const user = userEvent.setup()
    const { router } = open('/calendar?view=week')
    expect(await screen.findByRole('heading', { level: 1, name: he.week.title })).toBeInTheDocument()

    const nav = within(screen.getByRole('navigation', { name: he.shell.mainNav }))
    await user.click(nav.getByRole('link', { name: he.shell.calendar }))
    expect(await screen.findByRole('heading', { level: 1, name: he.today.title })).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(router.state.location.search).toBe('')
    expect(option(he.calendar.day)).toBeChecked()

    await user.click(nav.getByRole('link', { name: he.shell.calendar }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(router.state.location.search).toBe('')

    await router.navigate(-1)
    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=week')
    })
    expect(await screen.findByRole('heading', { level: 1, name: he.week.title })).toBeInTheDocument()
  })

  // The week screen moves through ?from= alone, and does not know about ?view=: the calendar keeps
  // the week on screen and puts view=week back into the address.
  it('the moves of the week stay in the week', async () => {
    const user = userEvent.setup()
    const { router } = open('/calendar?view=week')
    expect(await screen.findByRole('heading', { level: 1, name: he.week.title })).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: he.week.next }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=week&from=2026-11-22')
    })
    expect(screen.getByRole('heading', { level: 1, name: he.week.title })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: he.week.thisWeek }))
    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=week')
    })
    expect(screen.getByRole('heading', { level: 1, name: he.week.title })).toBeInTheDocument()
    expect(option(he.calendar.week)).toBeChecked()
  })
})
