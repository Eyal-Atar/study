import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AppProviders } from '../app/AppProviders'
import { routes } from '../app/routes'
import type { FakeAuth } from './fakeAuth'

// Renders the real routes at `path`, inside the real providers, with a fake auth client.
export function renderRoute(path: string, { auth, queryClient }: { auth: FakeAuth; queryClient?: QueryClient }) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = render(
    <AppProviders auth={auth.client} queryClient={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...result, router }
}
