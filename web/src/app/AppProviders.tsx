import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { I18nProvider } from 'react-aria-components'
import { LOCALE } from '../i18n/locale'
import { ApiContext } from '../api/ApiContext'
import type { ApiClient } from '../api/client'
import { AuthProvider } from '../auth/AuthProvider'
import { StorageContext, type StorageClient } from '../auth/storage'
import type { AuthClient } from '../auth/supabase'
import { PushProvider } from '../notifications/PushProvider'
import { ToastProvider } from '../ui/toast'

// The services are created once by the caller (main.tsx, or a test) and passed in.
// AuthProvider sits inside QueryClientProvider, because it clears the cache when the user changes.
// vapidPublicKey: from the environment (null when reminders are not set up); tests may leave it out.
export function AppProviders({
  auth,
  api,
  storage,
  queryClient,
  vapidPublicKey = null,
  children,
}: {
  auth: AuthClient
  api: ApiClient
  storage: StorageClient
  queryClient: QueryClient
  vapidPublicKey?: string | null
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale={LOCALE}>
        <ApiContext value={api}>
          <StorageContext value={storage}>
            <AuthProvider auth={auth}>
              <ToastProvider>
                <PushProvider vapidPublicKey={vapidPublicKey}>{children}</PushProvider>
              </ToastProvider>
            </AuthProvider>
          </StorageContext>
        </ApiContext>
      </I18nProvider>
    </QueryClientProvider>
  )
}
