import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { StrictMode } from 'react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import type { ApiClient } from '../api/client'
import { AppProviders } from '../app/AppProviders'
import { routes } from '../app/routes'
import type { FakeAuth } from './fakeAuth'
import { silentApi } from './fakeApi'

// Renders the real routes at `path`, inside the real providers, with a fake auth client.
export function renderRoute(path: string, { auth, api, queryClient }: { auth: FakeAuth; api?: ApiClient; queryClient?: QueryClient }) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Tests that do not care about the API get one that never answers.
  const apiClient = api ?? silentApi()
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = render(
    <StrictMode>
      <AppProviders auth={auth.client} api={apiClient} queryClient={client}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  )
  return { ...result, router }
}
