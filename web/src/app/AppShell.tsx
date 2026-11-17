import { CalendarDays, FileText, Sun, TrendingUp, type LucideIcon } from 'lucide-react'
import { useRef, type MouseEvent } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { he } from '../i18n/he'
import { ReplanOfferProvider } from '../plan/ReplanOffer'
import { cx, FOCUS_RING_NATIVE, ICON_STROKE } from '../ui/styles'
import { ToastRegion } from '../ui/toast'
import { ProfileMenu } from './ProfileMenu'
import { TimezoneSync } from './TimezoneSync'
import { useRouteFocus } from './useRouteFocus'

// The four destinations, in the order of the design language (section 6). Settings and sign out
// are not destinations: they live in the profile menu. The paths are literals because routes.tsx
// imports this file.
const DESTINATIONS: readonly { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/today', label: he.shell.today, icon: Sun },
  { to: '/week', label: he.shell.week, icon: CalendarDays },
  { to: '/exams', label: he.shell.exams, icon: FileText },
  { to: '/progress', label: he.shell.progress, icon: TrendingUp },
]

// One <nav> serves both widths, so a screen reader meets one navigation: on a phone it is the bar
// fixed to the bottom of the screen (above the home indicator), and from md it sits in the header
// row, next to the name.
const NAV = cx(
  'fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface px-safe pb-[env(safe-area-inset-bottom)]',
  'md:static md:z-auto md:border-t-0 md:bg-transparent md:px-0 md:pb-0',
)

// A destination. On a phone: a column, the icon over a caption, sharing the width of the bar, in a
// tap area of 52px. From md: a row, the icon before the label. The current one differs by colour
// and weight only: no fill, line or dot. The ring is inset (FOCUS_RING_NATIVE draws it 2px
// outside), because the bar touches the edges of the screen and an outer ring would be clipped.
function destinationClass({ isActive }: { isActive: boolean }) {
  return cx(
    'flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-caption',
    'md:min-h-touch md:flex-none md:flex-row md:gap-1.5 md:rounded-control md:px-3 md:text-small',
    'outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
    isActive ? 'font-semibold text-brand' : 'text-ink-muted hover:text-ink',
  )
}

// The frame of every signed-in screen: the skip link, a header (the name, the navigation, the
// profile menu), the screen itself, and the toasts. Screens render inside <main>, which already
// has the page gutter and width.
// ReplanOfferProvider: any screen can offer a replan (useReplanOffer); TimezoneSync keeps the
// profile's timezone in step with the browser (spec 7.3).
export function AppShell() {
  const onboarding = useLocation().pathname.startsWith('/onboarding')
  const main = useRef<HTMLElement>(null)
  useRouteFocus(main)

  // The link is a real anchor to #main, so it reads and behaves as a link. The move itself is done
  // here: following the href would add a history entry for the router to handle, and a browser
  // that scrolls to the target does not always move the focus with it.
  function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    main.current?.focus()
  }

  return (
    <ReplanOfferProvider>
      <TimezoneSync />
      <div className="min-h-dvh">
        {/* The first Tab stop of every screen. Out of sight above the screen until it has the focus. */}
        <a
          href="#main"
          onClick={skipToContent}
          className={cx(
            'absolute start-gutter top-2 z-50 -translate-y-[200%] rounded-control border border-line bg-surface px-4 py-2 text-small font-semibold text-ink focus:translate-y-0',
            FOCUS_RING_NATIVE,
          )}
        >
          {he.shell.skipToContent}
        </a>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex min-h-14 max-w-3xl items-center gap-4 px-page">
            <span className="text-body font-semibold">{he.appName}</span>
            {/* During the onboarding there is no board yet, and the gate sends every screen back:
                the header has only the name. */}
            {onboarding ? null : (
              <>
                {/* Before <main> in the DOM at both widths, so the Tab order is the same on a
                    phone and on a computer. */}
                <nav aria-label={he.shell.mainNav} className={NAV}>
                  {DESTINATIONS.map(({ to, label, icon: Icon }) => (
                    <NavLink key={to} to={to} className={destinationClass}>
                      {/* One element for both widths: 22px in the bar, 18px in the header row. */}
                      <Icon aria-hidden="true" strokeWidth={ICON_STROKE} className="size-[22px] shrink-0 md:size-[18px]" />
                      <span className="max-w-full truncate">{label}</span>
                    </NavLink>
                  ))}
                </nav>
                <div className="ms-auto">
                  <ProfileMenu />
                </div>
              </>
            )}
          </div>
        </header>
        {/* tabIndex -1: the target of the skip link, and of the focus after a navigation to a
            screen without an h1. Not a control, so no ring. On a phone the bottom padding clears
            the fixed bar (and the onboarding's own fixed bar of actions) and the home indicator. */}
        <main
          id="main"
          ref={main}
          tabIndex={-1}
          className="mx-auto w-full max-w-3xl px-page py-section pb-[calc(7rem+env(safe-area-inset-bottom))] outline-none md:pb-12"
        >
          <Outlet />
        </main>
        <ToastRegion />
      </div>
    </ReplanOfferProvider>
  )
}
