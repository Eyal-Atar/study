import { useEffect, type ReactNode } from 'react'
import { en } from '../i18n/en'
import { isolate } from '../i18n/bidi'
import { UserText } from './UserText'

export interface PageHeaderProps {
  title: string
  // The title is the user's own text (an exam name): the h1 takes its own direction and the tab
  // title isolates it.
  userTitle?: boolean
  // One quiet line under the title: a date, a count.
  subtitle?: ReactNode
  // The action of the screen, at the end side of the title. Under it when the row is too narrow.
  action?: ReactNode
}

// The title of a screen: its only h1, in the display size and the bold (700) of the prototype's
// phone title. A div and not a <header>, because the banner of the page is
// the shell's. The space under it belongs to the caller (space-y-section).
//
// The h1 takes the focus after a navigation (useRouteFocus in the shell), so it has tabIndex -1
// and no ring: it is not a control, and Tab never reaches it.
//
// It also names the browser tab ("Week – Archi"), since it is the component that knows the
// name of the screen (WCAG 2.4.2). On unmount the plain name comes back, so a screen without a
// PageHeader (login after a sign-out) is not left with the name of the previous one; the next
// header's effect runs after this cleanup and sets its own.
export function PageHeader({ title, subtitle, action, userTitle = false }: PageHeaderProps) {
  useEffect(() => {
    document.title = `${userTitle ? isolate(title) : title} – ${en.appName}`
    return () => {
      document.title = en.appName
    }
  }, [title, userTitle])

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      {/* min-w-0: inside a flex row the block may shrink below a long word, which then breaks. */}
      <div className="min-w-0">
        <h1 tabIndex={-1} className="text-display font-bold break-words text-ink outline-none">
          {userTitle ? <UserText>{title}</UserText> : title}
        </h1>
        {subtitle === undefined ? null : <p className="mt-1 text-small text-ink-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
