import { CalendarDays, FileText, Sprout, type LucideIcon } from 'lucide-react'
import { useRef, useState, type MouseEvent } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { DAY_CHOSEN } from '../calendar/calendarState'
import { he } from '../i18n/he'
import { InstallHint } from '../notifications/InstallHint'
import { PushSync } from '../notifications/PushSync'
import { ReplanOfferProvider } from '../plan/ReplanOffer'
import { cx, FOCUS_RING_NATIVE, ICON_STROKE } from '../ui/styles'
import { ToastRegion } from '../ui/toast'
import { Logo } from './Logo'
import { ProfileMenu } from './ProfileMenu'
import { ProgressChip } from './ProgressChip'
import { ShellToolbarSlot } from './ShellToolbar'
import { TimezoneSync } from './TimezoneSync'
import { useRouteFocus } from './useRouteFocus'

// The three destinations of the redesign (S31): the calendar, the exams and the progress. Settings
// and sign out are not destinations: they live in the profile menu. The paths are literals because
// routes.tsx imports this file. The calendar is current also on ?view=week: NavLink compares the
// pathname only. "יומן" asks for the day (DAY_CHOSEN): from the week, CalendarPage would otherwise
// take the move for one of the week's own and put ?view=week back (S31 decision 30). The progress
// is a sprout, the leaf of the mockup's bottom bar (decision 29).
const DESTINATIONS: readonly { to: string; label: string; icon: LucideIcon; state?: unknown }[] = [
  { to: '/calendar', label: he.shell.calendar, icon: CalendarDays, state: DAY_CHOSEN },
  { to: '/exams', label: he.shell.exams, icon: FileText },
  { to: '/progress', label: he.shell.progress, icon: Sprout },
]

// One <nav> serves both widths, so a screen reader meets one navigation and the Tab order is the
// same (S31 decision 10). Below lg it is the bar fixed to the bottom of the screen, a little
// translucent, above the home indicator (the prototype's .ph-nav); from lg it sits in the top bar
// as tabs (the prototype's .tabs).
const NAV = cx(
  'fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 px-safe pb-[env(safe-area-inset-bottom)]',
  'lg:static lg:z-auto lg:ms-4.5 lg:gap-1 lg:border-t-0 lg:bg-transparent lg:px-0 lg:pb-0',
)

// A destination. Below lg: a column, the icon over a caption, sharing the width of the bar, as tall
// as the bar. From lg: a tab, the label alone, with a soft fill when current. The current one also
// differs by weight, which is not a colour. The ring is inset (FOCUS_RING_NATIVE draws it 2px
// outside), because the bar touches the edges of the screen and an outer ring would be clipped.
function destinationClass({ isActive }: { isActive: boolean }) {
  return cx(
    'flex min-h-bottombar min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-caption',
    'lg:min-h-touch lg:flex-none lg:rounded-control lg:px-3.5 lg:text-body',
    'outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
    isActive ? 'font-semibold text-brand-strong lg:bg-brand-soft' : 'text-ink-muted hover:text-ink lg:font-medium lg:hover:bg-surface-muted',
  )
}

// The frame of every signed-in screen: the skip link, the top bar, the screen itself, and the
// toasts. Screens render inside <main>, which already has the page gutter and width.
// The top bar spans the screen (the prototype's .topbar): the logo, the navigation (from lg), the
// place of ShellToolbar (from lg, empty until S32 fills it), the progress chip and the profile menu.
// Below lg it is a thin header of the logo, the chip and the profile (the prototype's .ph-top), and
// the navigation is the bar at the bottom. The break is lg and not md: the redesign's computer
// layout starts at 1024px (S31 decision 9).
// ReplanOfferProvider: any screen can offer a replan (useReplanOffer); TimezoneSync keeps the
// profile's timezone in step with the browser (spec 7.3); PushSync sends this browser's push
// subscription again (S16), and InstallHint explains, once, how iOS gets reminders.
export function AppShell() {
  const onboarding = useLocation().pathname.startsWith('/onboarding')
  const main = useRef<HTMLElement>(null)
  // The place for ShellToolbar: a state and not a ref, so the screens render again once it exists.
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null)
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
      <PushSync />
      <ShellToolbarSlot element={toolbar}>
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
          {/* pt: the notch of a phone in landscape and of an installed app; the height is below it. */}
          <header className="border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
            <div className="flex h-14 items-center gap-3 px-page lg:h-topbar lg:gap-3.5 lg:px-gutter">
              <Logo />
              {/* During the onboarding there is no board yet, and the gate sends every screen back:
                  the header has only the logo. */}
              {onboarding ? null : (
                <>
                  {/* Before <main> in the DOM at both widths, so the Tab order is the same on a
                      phone and on a computer. */}
                  <nav aria-label={he.shell.mainNav} className={NAV}>
                    {DESTINATIONS.map(({ to, label, icon: Icon, state }) => (
                      <NavLink key={to} to={to} state={state} className={destinationClass}>
                        {/* In the bar only: the tabs of the top bar are words, as in the prototype. */}
                        <Icon aria-hidden="true" strokeWidth={ICON_STROKE} className="size-[22px] shrink-0 lg:hidden" />
                        <span className="max-w-full truncate">{label}</span>
                      </NavLink>
                    ))}
                  </nav>
                  {/* The place of ShellToolbar. flex-1 pushes the chip and the profile to the end;
                      min-w-0 lets a long control shrink instead of pushing them off the bar. */}
                  <div ref={setToolbar} className="hidden min-w-0 flex-1 items-center justify-end gap-2 lg:flex" />
                  <div className="ms-auto flex shrink-0 items-center gap-2">
                    <ProgressChip />
                    <ProfileMenu />
                  </div>
                </>
              )}
            </div>
          </header>
          {/* tabIndex -1: the target of the skip link, and of the focus after a navigation to a
              screen without an h1. Not a control, so no ring. Below lg the bottom padding clears
              the fixed bar (and the onboarding's own fixed bar of actions) and the home indicator. */}
          <main
            id="main"
            ref={main}
            tabIndex={-1}
            className="mx-auto w-full max-w-3xl px-page py-section pb-[calc(7rem+env(safe-area-inset-bottom))] outline-none lg:pb-12"
          >
            {onboarding ? null : <InstallHint />}
            <Outlet />
          </main>
          <ToastRegion />
        </div>
      </ShellToolbarSlot>
    </ReplanOfferProvider>
  )
}
