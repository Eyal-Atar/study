import { useEffect } from 'react'

function releaseQuietly(sentinel: WakeLockSentinel) {
  try {
    sentinel.release().catch(() => undefined)
  } catch {
    // Already gone: nothing to release.
  }
}

// Keeps the screen on while the focus screen runs (S42 decision 13). An extra, not a condition: a
// browser without the API, or one that refuses (battery saver, permissions policy), gets nothing and
// no message. The browser lets the lock go by itself when the page hides, so a page that becomes
// visible again asks again. The sentinel lives in the effect, one per run, so a lock that arrives
// after the run is over (active turned false, or unmount, while the request was on its way) is
// released at once instead of holding the screen on.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let live = true
    let pending = false
    let sentinel: WakeLockSentinel | null = null

    const acquire = () => {
      if (pending || document.visibilityState !== 'visible') return
      if (sentinel !== null && !sentinel.released) return
      pending = true
      let request: Promise<WakeLockSentinel>
      try {
        request = navigator.wakeLock.request('screen')
      } catch {
        pending = false
        return
      }
      request.then(
        (s) => {
          pending = false
          if (live) sentinel = s
          else releaseQuietly(s)
        },
        () => {
          pending = false
        },
      )
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisibility)
      if (sentinel !== null && !sentinel.released) releaseQuietly(sentinel)
      sentinel = null
    }
  }, [active])
}
