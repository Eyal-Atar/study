import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiContext } from '../api/ApiContext'
import { meKey } from '../api/me'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { todayKey } from '../board/api'
import { en } from '../i18n/en'
import { makeMe, makeToday, USER_ID } from '../test/boardFixtures'
import { silentApi } from '../test/fakeApi'
import { fakeSession } from '../test/fakeAuth'
import { OfflineIcon } from '../ui/icons'
import { OfflineNotice } from './OfflineNotice'

const TZ = 'Asia/Jerusalem'
// Sunday 22 November 2026, 12:00 in Jerusalem (UTC+2).
const NOW = '2026-11-22T12:00:00+02:00'
const TODAY_1120 = Date.parse('2026-11-22T11:20:00+02:00')
const YESTERDAY_0900 = Date.parse('2026-11-21T09:00:00+02:00')

const SIGNED_IN: AuthState = { status: 'signed_in', session: fakeSession({ id: USER_ID }) }

// The notice with a cache as the device snapshot leaves it: the profile, and "today" as of `todayAt`.
function show({
  auth = SIGNED_IN,
  todayAt,
  todayOf = USER_ID,
  className,
}: { auth?: AuthState; todayAt?: number; todayOf?: string; className?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(meKey(USER_ID), makeMe(TZ))
  if (todayAt !== undefined) queryClient.setQueryData(todayKey(todayOf), makeToday(), { updatedAt: todayAt })
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiContext value={silentApi()}>
        <AuthContext value={{ ...auth, signInWithGoogle: () => Promise.resolve(), signOut: () => Promise.resolve() }}>
          <OfflineNotice {...(className === undefined ? {} : { className })} />
        </AuthContext>
      </ApiContext>
    </QueryClientProvider>,
  )
}

function notice() {
  return document.querySelector('[data-offline-notice]')
}

beforeEach(() => {
  // The clock alone: the timers stay real, so React Query and Testing Library run as usual.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  onlineManager.setOnline(true)
  vi.useRealTimers()
})

describe('OfflineNotice', () => {
  it('shows nothing with a network', () => {
    const { container } = show({ todayAt: TODAY_1120 })

    expect(container).toBeEmptyDOMElement()
  })

  it('without a network it says what is shown, as of when "today" was last read, and when actions come back', () => {
    onlineManager.setOnline(false)
    show({ todayAt: TODAY_1120 })

    expect(notice()).toHaveTextContent(en.offline.notice('11:20'))
    expect(notice()?.textContent).toBe(en.offline.notice('11:20'))
  })

  it('a calendar of another day says the day too', () => {
    onlineManager.setOnline(false)
    show({ todayAt: YESTERDAY_0900 })

    expect(notice()?.textContent).toBe(en.offline.notice('Sat, 21 Nov, 09:00'))
  })

  it('without "today" in the cache it gives no time', () => {
    onlineManager.setOnline(false)
    show()

    expect(notice()?.textContent).toBe(en.offline.noticeNoTime)
  })

  it('reads only this user’s "today"', () => {
    onlineManager.setOnline(false)
    show({ todayAt: TODAY_1120, todayOf: 'user-b' })

    expect(notice()?.textContent).toBe(en.offline.noticeNoTime)
  })

  it('is shown in offline mode even with a network: the session is not back yet', () => {
    show({ auth: { status: 'offline', userId: USER_ID }, todayAt: TODAY_1120 })

    expect(onlineManager.isOnline()).toBe(true)
    expect(notice()?.textContent).toBe(en.offline.notice('11:20'))
  })

  it('appears when the network goes, and leaves when it is back', () => {
    show({ todayAt: TODAY_1120 })
    expect(notice()).toBeNull()

    act(() => {
      onlineManager.setOnline(false)
    })
    expect(notice()).toHaveTextContent(en.offline.notice('11:20'))

    act(() => {
      onlineManager.setOnline(true)
    })
    expect(notice()).toBeNull()
  })

  it('is ordinary content: the crossed-out waves as decoration, and no role (OfflineAnnouncer speaks)', () => {
    onlineManager.setOnline(false)
    show({ todayAt: TODAY_1120 })

    const root = notice()
    expect(root).not.toHaveAttribute('role')
    expect(root).not.toHaveAttribute('aria-live')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const icons = root?.querySelectorAll('svg')
    expect(icons).toHaveLength(1)
    const icon = icons?.[0]
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveAttribute('width', '18')
    expect(icon).toHaveAttribute('height', '18')
    expect(icon).toHaveClass('shrink-0', 'text-inverse-danger')
    expect(icon?.innerHTML).toBe(render(<OfflineIcon />).container.querySelector('svg')?.innerHTML)
  })

  it('looks like the banner of the prototype: dark on any theme, 14px corners, the icon at the first line', () => {
    onlineManager.setOnline(false)
    show({ todayAt: TODAY_1120 })

    expect(notice()).toHaveClass(
      'flex', 'items-start', 'gap-2.5', 'rounded-[14px]', 'bg-inverse', 'px-3.5', 'py-2.5', 'text-[13.5px]', 'text-on-inverse',
    )
    // The sentence wraps inside the banner instead of pushing the icon out.
    expect(screen.getByText(en.offline.notice('11:20'))).toHaveClass('min-w-0')
  })

  it('takes the margins of the place it is put in', () => {
    onlineManager.setOnline(false)
    show({ todayAt: TODAY_1120, className: 'mx-3.5 mb-1.5' })

    expect(notice()).toHaveClass('mx-3.5', 'mb-1.5', 'bg-inverse')
  })
})
