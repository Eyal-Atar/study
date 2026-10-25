import { he } from '../i18n/he'

// A temporary screen, until the app has routes.
export function App() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-bold">{he.appName}</h1>
      <p className="mt-2 text-slate-600">{he.tagline}</p>
    </main>
  )
}
