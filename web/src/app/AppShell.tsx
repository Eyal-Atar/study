import { Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { he } from '../i18n/he'
import { ReplanOfferProvider } from '../plan/ReplanOffer'
import { Button } from '../ui/Button'
import { ToastRegion } from '../ui/toast'
import { TimezoneSync } from './TimezoneSync'

// The frame of every signed-in screen: a header, the screen itself, and the toasts.
// Screens render inside <main>, which already has the page gutter and width.
// ReplanOfferProvider: any screen can offer a replan (useReplanOffer); TimezoneSync keeps the
// profile's timezone in step with the browser (spec 7.3).
export function AppShell() {
  const { signOut } = useAuth()
  return (
    <ReplanOfferProvider>
      <TimezoneSync />
      <div className="min-h-dvh">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-2">
            <span className="text-lg font-bold">{he.appName}</span>
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
