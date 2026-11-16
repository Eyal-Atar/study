import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { I18nProvider } from 'react-aria-components'
import { ApiContext } from '../api/ApiContext'
import type { ApiClient } from '../api/client'
import { AuthProvider } from '../auth/AuthProvider'
import { StorageContext, type StorageClient } from '../auth/storage'
import type { AuthClient } from '../auth/supabase'
import { ToastProvider } from '../ui/toast'

// The services are created once by the caller (main.tsx, or a test) and passed in.
// AuthProvider sits inside QueryClientProvider, because it clears the cache when the user changes.
export function AppProviders({
  auth,
  api,
  storage,
  queryClient,
  children,
}: {
  auth: AuthClient
  api: ApiClient
  storage: StorageClient
  queryClient: QueryClient
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="he-IL">
        <ApiContext value={api}>
          <StorageContext value={storage}>
            <AuthProvider auth={auth}>
              <ToastProvider>{children}</ToastProvider>
            </AuthProvider>
          </StorageContext>
        </ApiContext>
      </I18nProvider>
    </QueryClientProvider>
  )
}
