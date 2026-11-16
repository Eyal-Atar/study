import { he } from '../i18n/he'

// The progress board (S19): level, XP, streak and badges, in a quiet tone (spec 7.9).
export function ProgressPage() {
  return <h1 className="text-2xl font-bold">{he.progress.title}</h1>
}
