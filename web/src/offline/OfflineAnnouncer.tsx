import { useEffect, useState } from 'react'
import { en } from '../i18n/en'
import { useReadOnly } from './useReadOnly'

// How long the announcement stays in the live region. Long enough for a screen reader to read it,
// short enough that it is gone before the user wanders into it with the reading cursor.
export const ANNOUNCE_CLEAR_MS = 5000

// What a screen reader hears when the app becomes read only (S38), once per transition. Apart from
// OfflineNotice on purpose: the notice is mounted by each screen and comes and goes with the route, so
// as a live region it would be read on every screen; this one region sits in the shell for the life
// of the app, and its text changes only when the state does.
// The region is always there and empty, and the text arrives a tick after the transition: a screen
// reader reads a change inside a region it already knows, not a region that arrives with its text
// (the app opened offline). The timers also keep setState out of the body of the effect.
export function OfflineAnnouncer() {
  const readOnly = useReadOnly()
  const [announcing, setAnnouncing] = useState(false)

  useEffect(() => {
    if (!readOnly) return
    const show = window.setTimeout(() => {
      setAnnouncing(true)
    }, 0)
    const clear = window.setTimeout(() => {
      setAnnouncing(false)
    }, ANNOUNCE_CLEAR_MS)
    return () => {
      window.clearTimeout(show)
      window.clearTimeout(clear)
      // Back with a network: nothing left to say, and the next transition starts from empty.
      setAnnouncing(false)
    }
  }, [readOnly])

  return (
    <div role="status" className="sr-only">
      {announcing ? en.offline.announce : null}
    </div>
  )
}
