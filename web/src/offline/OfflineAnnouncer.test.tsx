import { onlineManager } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { en } from '../i18n/en'
import { fakeSession } from '../test/fakeAuth'
import { ANNOUNCE_CLEAR_MS, OfflineAnnouncer } from './OfflineAnnouncer'

const SIGNED_IN: AuthState = { status: 'signed_in', session: fakeSession() }

function tree(auth: AuthState, children: ReactNode = null) {
  return (
    <StrictMode>
      <AuthContext value={{ ...auth, signInWithGoogle: () => Promise.resolve(), signOut: () => Promise.resolve() }}>
        <OfflineAnnouncer />
        {children}
      </AuthContext>
    </StrictMode>
  )
}

function show(auth: AuthState = SIGNED_IN) {
  return render(tree(auth))
}

function region() {
  return screen.getByRole('status')
}

function setOnline(online: boolean) {
  act(() => {
    onlineManager.setOnline(online)
  })
}

// The announcement arrives a tick after the transition (see OfflineAnnouncer).
function tick(ms = 0) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  onlineManager.setOnline(true)
  vi.useRealTimers()
})

describe('OfflineAnnouncer', () => {
  it('is always one polite live region, out of sight, and empty with a network', () => {
    show()
    tick()

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(region()).toHaveClass('sr-only')
    expect(region()).toBeEmptyDOMElement()
    expect(ANNOUNCE_CLEAR_MS).toBe(5000)
  })

  it('says it once when the network goes', () => {
    show()
    tick()

    setOnline(false)
    // The same region as before, filled after the transition: a region that arrives with its text
    // is not read.
    tick()
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(region().textContent).toBe(en.offline.announce)
  })

  it('another render does not change it, so it is not read again', () => {
    const view = show()
    setOnline(false)
    tick()
    const node = region().firstChild

    view.rerender(tree(SIGNED_IN, <p>another screen</p>))
    tick()
    expect(region().textContent).toBe(en.offline.announce)
    // The very same text node: nothing for a screen reader to notice.
    expect(region().firstChild).toBe(node)
  })

  it('is empty again after ANNOUNCE_CLEAR_MS, and stays empty while still offline', () => {
    show()
    setOnline(false)
    tick()

    tick(ANNOUNCE_CLEAR_MS - 1)
    expect(region().textContent).toBe(en.offline.announce)
    tick(1)
    expect(region()).toBeEmptyDOMElement()
    tick(60_000)
    expect(region()).toBeEmptyDOMElement()
  })

  it('is empty at once when the network is back', () => {
    show()
    setOnline(false)
    tick()

    setOnline(true)
    expect(region()).toBeEmptyDOMElement()
    tick(ANNOUNCE_CLEAR_MS)
    expect(region()).toBeEmptyDOMElement()
  })

  it('says it again on the next transition to offline, also within the five seconds', () => {
    show()
    setOnline(false)
    tick()
    setOnline(true)
    expect(region()).toBeEmptyDOMElement()

    setOnline(false)
    tick()
    expect(region().textContent).toBe(en.offline.announce)
    // And this announcement has its own five seconds.
    tick(ANNOUNCE_CLEAR_MS - 1)
    expect(region().textContent).toBe(en.offline.announce)
    tick(1)
    expect(region()).toBeEmptyDOMElement()

    setOnline(true)
    setOnline(false)
    tick()
    expect(region().textContent).toBe(en.offline.announce)
  })

  it('an app opened offline says it once, into a region that was there empty first', () => {
    onlineManager.setOnline(false)
    show()

    expect(region()).toBeEmptyDOMElement()
    tick()
    expect(region().textContent).toBe(en.offline.announce)
  })

  it('follows read only, not the network alone: in offline mode the network coming back is no new transition', () => {
    onlineManager.setOnline(false)
    show({ status: 'offline', userId: 'u1' })
    tick()
    expect(region().textContent).toBe(en.offline.announce)
    tick(ANNOUNCE_CLEAR_MS)
    expect(region()).toBeEmptyDOMElement()

    // The network is back, the session is not: still read only, and nothing is said.
    setOnline(true)
    tick(ANNOUNCE_CLEAR_MS)
    expect(region()).toBeEmptyDOMElement()
    setOnline(false)
    tick(ANNOUNCE_CLEAR_MS)
    expect(region()).toBeEmptyDOMElement()
  })
})
