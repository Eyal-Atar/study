import { onlineManager } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useUserId } from '../api/me'
import { AuthContext, type AuthState } from '../auth/AuthContext'
import { useBoardUserId } from '../board/api'
import { fakeSession } from '../test/fakeAuth'
import { useReadOnly } from './useReadOnly'

function wrapperFor(state: AuthState) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext value={{ ...state, signInWithGoogle: () => Promise.resolve(), signOut: () => Promise.resolve() }}>{children}</AuthContext>
    )
  }
}

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('useReadOnly', () => {
  it('is true without a network', () => {
    onlineManager.setOnline(false)
    const { result } = renderHook(() => useReadOnly(), { wrapper: wrapperFor({ status: 'signed_in', session: fakeSession() }) })

    expect(result.current).toBe(true)
  })

  it('is true offline even when the network is back (the token is not refreshed yet)', () => {
    const { result } = renderHook(() => useReadOnly(), { wrapper: wrapperFor({ status: 'offline', userId: 'u1' }) })

    expect(onlineManager.isOnline()).toBe(true)
    expect(result.current).toBe(true)
  })

  it('is false signed in with a network, and follows the network', () => {
    const { result } = renderHook(() => useReadOnly(), { wrapper: wrapperFor({ status: 'signed_in', session: fakeSession() }) })
    expect(result.current).toBe(false)

    act(() => {
      onlineManager.setOnline(false)
    })
    expect(result.current).toBe(true)
  })
})

describe('the user id of the cache keys', () => {
  it('is the snapshot owner offline', () => {
    const wrapper = wrapperFor({ status: 'offline', userId: 'u1' })

    expect(renderHook(() => useUserId(), { wrapper }).result.current).toBe('u1')
    expect(renderHook(() => useBoardUserId(), { wrapper }).result.current).toBe('u1')
  })

  it('is the session user signed in, and null signed out', () => {
    const signedIn = wrapperFor({ status: 'signed_in', session: fakeSession({ id: 'u2' }) })
    const signedOut = wrapperFor({ status: 'signed_out' })

    expect(renderHook(() => useUserId(), { wrapper: signedIn }).result.current).toBe('u2')
    expect(renderHook(() => useBoardUserId(), { wrapper: signedIn }).result.current).toBe('u2')
    expect(renderHook(() => useUserId(), { wrapper: signedOut }).result.current).toBeNull()
    expect(renderHook(() => useBoardUserId(), { wrapper: signedOut }).result.current).toBeNull()
  })
})
