import { NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { he } from '../i18n/he'
import { ReplanOfferProvider } from '../plan/ReplanOffer'
import { Button } from '../ui/Button'
import { ToastRegion } from '../ui/toast'
import { TimezoneSync } from './TimezoneSync'

// A tab of the main navigation: 44px tall, and NavLink sets aria-current="page" on the current one.
function tabClass({ isActive }: { isActive: boolean }) {
  return `inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand ${
    isActive ? 'border-brand text-brand-strong' : 'border-transparent text-ink-muted hover:text-ink'
  }`
}

// The frame of every signed-in screen: a header, the screen itself, and the toasts.
// Screens render inside <main>, which already has the page gutter and width.
// ReplanOfferProvider: any screen can offer a replan (useReplanOffer); TimezoneSync keeps the
// profile's timezone in step with the browser (spec 7.3).
export function AppShell() {
  const { signOut } = useAuth()
  const onboarding = useLocation().pathname.startsWith('/onboarding')
  return (
    <ReplanOfferProvider>
      <TimezoneSync />
      <div className="min-h-dvh">
        <header className="border-b border-line bg-surface">
          {/* On a phone the five links get their own row under the name and "יציאה" (390px, S15). */}
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 px-4 py-2">
            <div className="contents sm:flex sm:items-center sm:gap-4">
              <span className="text-lg font-bold">{he.appName}</span>
              {/* During the onboarding there is no board yet, and the gate sends both screens back. */}
              {onboarding ? null : (
                <nav aria-label={he.shell.mainNav} className="order-last -mx-3 flex w-full overflow-x-auto sm:order-none sm:mx-0 sm:w-auto">
                  <NavLink to="/today" className={tabClass}>
                    {he.shell.today}
                  </NavLink>
                  <NavLink to="/week" className={tabClass}>
                    {he.shell.week}
                  </NavLink>
                  <NavLink to="/exams" className={tabClass}>
                    {he.shell.exams}
                  </NavLink>
                  <NavLink to="/progress" className={tabClass}>
                    {he.shell.progress}
                  </NavLink>
                  <NavLink to="/settings" className={tabClass}>
                    {he.shell.settings}
                  </NavLink>
                </nav>
              )}
            </div>
            <Button
              variant="quiet"
              onPress={() => {
                void signOut()
              }}
            >
              {he.shell.signOut}
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6 pb-28">
          <Outlet />
        </main>
        <ToastRegion />
      </div>
    </ReplanOfferProvider>
  )
}
