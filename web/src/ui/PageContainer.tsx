import type { ReactNode } from 'react'

// The <main> of a screen outside the app shell (login, not found, goodbye): the same column and
// gutter as a screen inside it, with more air above, since there is no header.
// px-page: the gutter, or the safe area of the phone when it is wider (index.css).
export function StandalonePage({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-3xl px-page py-16">{children}</main>
}
