import { createContext, use, useEffect } from 'react'

// What a screen may ask of the frame around it (S32: only the calendar asks). fullBleed: main
// drops its column (max-w-3xl and the page padding), so the calendar can use the whole width and
// height. ownPhoneHeader: below lg the shell's thin header bar (logo, chip, profile) folds away,
// because the screen draws one header of its own with the chip and the profile in it, as in the
// mockups; the navigation, fixed at the bottom, stays. From lg the top bar is the shell's as always.
export interface ShellFrame {
  fullBleed: boolean
  ownPhoneHeader: boolean
  // A screen that stands alone (S42, the focus screen): no top bar and no navigation, no column, no
  // padding of main and no install hint; the screen brings its own way out and its own padding. The
  // skip link and the toasts stay.
  bare: boolean
}

export const PLAIN_FRAME: ShellFrame = { fullBleed: false, ownPhoneHeader: false, bare: false }

// AppShell keeps the frame in its state and gives every screen the way to ask for one.
export const ShellFrameRequest = createContext<((frame: ShellFrame) => void) | null>(null)

// Asked while the screen is mounted, and given back when it unmounts, so the next screen gets the
// plain frame. Outside the shell (a test of the screen alone) it does nothing.
export function useShellFrame({ fullBleed = false, ownPhoneHeader = false, bare = false }: Partial<ShellFrame>): void {
  const request = use(ShellFrameRequest)
  useEffect(() => {
    if (request === null) return
    request({ fullBleed, ownPhoneHeader, bare })
    return () => {
      request(PLAIN_FRAME)
    }
  }, [request, fullBleed, ownPhoneHeader, bare])
}
