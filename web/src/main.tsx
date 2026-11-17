import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { App } from './app/App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import { AppProviders } from './app/AppProviders'
import { createAppApi } from './app/createAppApi'
import { createQueryClient } from './app/queryClient'
import { routes } from './app/routes'
import { createStorage } from './auth/storage'
import { createSupabase } from './auth/supabase'
import { EnvError, readEnv, type WebEnv } from './config/env'
import { ConfigErrorScreen } from './pages/ConfigErrorScreen'
import { registerServiceWorker } from './pwa/register'
import './index.css'

// Reads the environment, creates each service once, and wires them into the providers and the router.
function createApp(): ReactNode {
  let env: WebEnv
  try {
    env = readEnv(import.meta.env)
  } catch (error) {
    if (error instanceof EnvError) return <ConfigErrorScreen problems={error.problems} />
    throw error
  }
  const supabase = createSupabase(env)
  const api = createAppApi(env.apiUrl, supabase.auth)
  const storage = createStorage(supabase)
  const queryClient = createQueryClient()
  const router = createBrowserRouter(routes)
  return (
    <AppProviders auth={supabase.auth} api={api} storage={storage} queryClient={queryClient} vapidPublicKey={env.vapidPublicKey}>
      <RouterProvider router={router} />
    </AppProviders>
  )
}

const root = document.getElementById('root')
if (root === null) {
  throw new Error('index.html has no #root element')
}

// AppErrorBoundary above every provider: an error while rendering shows a Hebrew message with a
// reload button, not a white page. The boot fallback in index.html covers a failure before this runs.
createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App create={createApp} />
    </AppErrorBoundary>
  </StrictMode>,
)
registerServiceWorker()
