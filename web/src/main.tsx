import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AppProviders } from './app/AppProviders'
import { createQueryClient } from './app/queryClient'
import { routes } from './app/routes'
import { createSupabase } from './auth/supabase'
import { EnvError, readEnv, type WebEnv } from './config/env'
import { ConfigErrorScreen } from './pages/ConfigErrorScreen'
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
  const queryClient = createQueryClient()
  const router = createBrowserRouter(routes)
  return (
    <AppProviders auth={supabase.auth} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  )
}

const root = document.getElementById('root')
if (root === null) {
  throw new Error('index.html has no #root element')
}

createRoot(root).render(<StrictMode>{createApp()}</StrictMode>)
