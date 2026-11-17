import { useState, type ReactNode } from 'react'

// Builds the app once, inside a component: an error thrown while creating the services (main.tsx's
// createApp) then reaches AppErrorBoundary, instead of throwing before React renders anything.
export function App({ create }: { create: () => ReactNode }) {
  const [app] = useState(create)
  return app
}
