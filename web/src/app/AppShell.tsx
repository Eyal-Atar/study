import { Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { ToastRegion } from '../ui/toast'

// The frame of every signed-in screen: a header, the screen itself, and the toasts.
// Screens render inside <main>, which already has the page gutter and width.
export function AppShell() {
  const { signOut } = useAuth()
  return (
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
  )
}
