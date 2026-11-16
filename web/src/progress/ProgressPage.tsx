import { errorMessage } from '../api/client'
import { he } from '../i18n/he'
import { Button } from '../ui/Button'
import { useProgress } from './api'
import { BadgeGrid } from './BadgeGrid'
import { LevelCard } from './LevelCard'
import { StreakCard } from './StreakCard'

// The progress board (S19): level, XP, streak and badges, in a quiet tone (spec 7.9): no motion,
// no confetti, no red. Everything comes from GET /progress; the board only shows it.
export function ProgressPage() {
  const progress = useProgress()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-ink">{he.progress.title}</h1>
      {progress.isPending ? (
        <p className="text-ink-muted">{he.common.loading}</p>
      ) : progress.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-danger">
            {errorMessage(progress.error)}
          </p>
          <Button
            variant="secondary"
            onPress={() => {
              void progress.refetch()
            }}
          >
            {he.common.retry}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <LevelCard progress={progress.data} />
            <StreakCard progress={progress.data} />
          </div>
          <BadgeGrid progress={progress.data} />
        </>
      )}
    </div>
  )
}
