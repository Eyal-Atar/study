import { he } from '../i18n/he'
import { ProgressBar } from '../ui/ProgressBar'

// The minutes of today (decision 11): real minutes from the server, done out of all of today's
// (what is left plus what is done), not a made-up percentage.
export function DayProgress({ done, planned }: { done: number; planned: number }) {
  const total = planned + done
  if (total <= 0) return null
  return <ProgressBar label={he.today.progressLabel} value={done} max={total} valueText={he.today.progress(done, total)} />
}
