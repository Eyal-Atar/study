import { he } from '../i18n/he'

// Shown by main.tsx instead of the app when readEnv() fails. The problems are for the developer,
// in English, so the list is left to right.
export function ConfigErrorScreen({ problems }: { problems: readonly string[] }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold">{he.config.title}</h1>
      <p className="mt-4 text-slate-700">{he.config.body}</p>
      <ul dir="ltr" className="mt-4 list-disc space-y-2 ps-6 font-mono text-sm">
        {problems.map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
    </main>
  )
}
