import { CalendarDays, FileText, SproutIcon, type IconType } from '../ui/icons'
import { useRef, useState, type MouseEvent } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { en } from '../i18n/en'
import { InstallHint } from '../notifications/InstallHint'
import { PushSync } from '../notifications/PushSync'
import { ReplanOfferProvider } from '../plan/ReplanOffer'
import { cx, FOCUS_RING_NATIVE, ICON_STROKE } from '../ui/styles'
import { ToastRegion } from '../ui/toast'
import { Logo } from './Logo'
import { ProfileMenu } from './ProfileMenu'
import { ProgressChip } from './ProgressChip'
import { PLAIN_FRAME, ShellFrameRequest, type ShellFrame } from './shellFrame'
import { ShellToolbarSlot } from './ShellToolbar'
import { TimezoneSync } from './TimezoneSync'
import { useRouteFocus } from './useRouteFocus'

// The three destinations of the redesign (S31): the calendar, the exams and the progress. Settings
// and sign out are not destinations: they live in the profile menu. The paths are literals because
// routes.tsx imports this file. The calendar is current also on ?view=day and ?date=: NavLink
// compares the pathname only. The progress is Archi's sprout, the leaf of the mockup's bottom bar
// (decision 29).
const DESTINATIONS: readonly { to: string; label: string; icon: IconType }[] = [
  { to: '/calendar', label: en.shell.calendar, icon: CalendarDays },
  { to: '/exams', label: en.shell.exams, icon: FileText },
  { to: '/progress', label: en.shell.progress, icon: SproutIcon },
]

// One <nav> serves both widths, so a screen reader meets one navigation and the Tab order is the
// same (S31 decision 10). Below lg it is the bar fixed to the bottom of the screen, a little
// translucent, above the home indicator (the prototype's .ph-nav); from lg it sits in the top bar
// as tabs (the prototype's .tabs).
const NAV = cx(
  'fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/97 backdrop-blur-sm px-safe pb-[env(safe-area-inset-bottom)]',
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
  // What the screen asked of the frame (useShellFrame): only the calendar asks (S32).
  const [frame, setFrame] = useState<ShellFrame>(PLAIN_FRAME)
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
      <ShellFrameRequest value={setFrame}>
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
              {en.shell.skipToContent}
            </a>
            {/* A bare screen (S42, the focus screen) stands alone: no bar and no navigation. */}
            {frame.bare ? null : (
              <>
                {/* pt: the notch of a phone in landscape and of an installed app; the height is below it. */}
                {/* The calendar draws its own header below lg (S32 decision 2), so the phone shows one:
                    there the bar folds to nothing, and only the navigation, fixed at the bottom, stays. */}
                <header
                  className={cx(
                    'border-b border-line bg-surface pt-[env(safe-area-inset-top)]',
                    frame.ownPhoneHeader && 'max-lg:border-b-0 max-lg:pt-0',
                  )}
                >
                  <div
                    className={cx(
                      'flex h-14 items-center gap-3 px-page lg:h-topbar lg:gap-3.5 lg:px-gutter',
                      frame.ownPhoneHeader && 'max-lg:h-0',
                    )}
                  >
                    <div className={cx('contents', frame.ownPhoneHeader && 'max-lg:hidden')}>
                      <Logo />
                    </div>
                    {/* During the onboarding there is no board yet, and the gate sends every screen back:
                        the header has only the logo. */}
                    {onboarding ? null : (
                      <>
                        {/* Before <main> in the DOM at both widths, so the Tab order is the same on a
                            phone and on a computer. */}
                        <nav aria-label={en.shell.mainNav} className={NAV}>
                          {DESTINATIONS.map(({ to, label, icon: Icon }) => (
                            <NavLink key={to} to={to} className={destinationClass}>
                              {/* In the bar only: the tabs of the top bar are words, as in the prototype. */}
                              <Icon aria-hidden="true" strokeWidth={ICON_STROKE} className="size-[22px] shrink-0 lg:hidden" />
                              <span className="max-w-full truncate">{label}</span>
                            </NavLink>
                          ))}
                        </nav>
                        {/* The place of ShellToolbar. flex-1 pushes the chip and the profile to the end;
                            min-w-0 lets a long control shrink instead of pushing them off the bar. */}
                        <div ref={setToolbar} className="hidden min-w-0 flex-1 items-center justify-end gap-2 lg:flex" />
                        <div className={cx('ms-auto flex shrink-0 items-center gap-2', frame.ownPhoneHeader && 'max-lg:hidden')}>
                          <ProgressChip />
                          <ProfileMenu />
                        </div>
                      </>
                    )}
                  </div>
                </header>
              </>
            )}
            {/* tabIndex -1: the target of the skip link, and of the focus after a navigation to a
                screen without an h1. Not a control, so no ring. Below lg the bottom padding clears
                the fixed bar (and the onboarding's own fixed bar of actions) and the home indicator. */}
            <main
              id="main"
              ref={main}
              tabIndex={-1}
              className={cx(
                'w-full outline-none',
                // A bare screen brings its own padding, and has no bar at the bottom to clear.
                !frame.bare && 'pb-[calc(7rem+env(safe-area-inset-bottom))]',
                // The calendar uses the whole width, and from lg the whole height under the top bar.
                !frame.bare && (frame.fullBleed ? 'lg:pb-0' : 'mx-auto max-w-3xl px-page py-section lg:pb-12'),
              )}
            >
              {onboarding || frame.bare ? null : (
                // A full-bleed screen has no gutter of <main>: the hint brings its own (and the
                // wrapper takes no room when the hint is not shown). One place in the tree for both,
                // so the hint does not mount again (and count as seen) when the frame changes.
                <div className={frame.fullBleed ? 'px-page pt-3 empty:hidden' : undefined}>
                  <InstallHint />
                </div>
              )}
              <Outlet />
            </main>
            <ToastRegion />
          </div>
        </ShellToolbarSlot>
      </ShellFrameRequest>
    </ReplanOfferProvider>
  )
}
