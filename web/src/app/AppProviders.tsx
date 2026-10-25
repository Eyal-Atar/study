import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { I18nProvider } from 'react-aria-components'
import { AuthProvider } from '../auth/AuthProvider'
import type { AuthClient } from '../auth/supabase'

// The services are created once by the caller (main.tsx, or a test) and passed in.
// AuthProvider sits inside QueryClientProvider, because it clears the cache when the user changes.
export function AppProviders({
  auth,
  queryClient,
  children,
}: {
  auth: AuthClient
  queryClient: QueryClient
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="he-IL">
        <AuthProvider auth={auth}>{children}</AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  )
}
