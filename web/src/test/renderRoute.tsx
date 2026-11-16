import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import type { ApiClient } from '../api/client'
import type { StorageClient } from '../auth/storage'
import { AppProviders } from '../app/AppProviders'
import { routes } from '../app/routes'
import type { FakeAuth } from './fakeAuth'
import { silentApi } from './fakeApi'
import { createFakeStorage } from './fakeStorage'

// Renders the real routes at `path`, inside the real providers, with a fake auth client.
export function renderRoute(
  path: string,
  {
    auth,
    api,
    storage,
    queryClient,
  }: { auth: FakeAuth; api?: ApiClient; storage?: StorageClient; queryClient?: QueryClient },
) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Tests that do not care about the API get one that never answers.
  const apiClient = api ?? silentApi()
  // Tests that do not care about Storage get one where every upload succeeds.
  const storageClient = storage ?? createFakeStorage().client
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = render(
    <StrictMode>
      <AppProviders auth={auth.client} api={apiClient} storage={storageClient} queryClient={client}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  )
  return { ...result, router }
}
