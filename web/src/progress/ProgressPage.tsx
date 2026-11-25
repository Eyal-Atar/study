import { errorMessage } from '../api/client'
import { useProfileTimezone } from '../board/time'
import { en } from '../i18n/en'
import { PageHeader } from '../ui/PageHeader'
import { ErrorState, LoadingState } from '../ui/states'
import { useProgress } from './api'
import { ArchiveList } from './ArchiveList'
import { BadgeGrid } from './BadgeGrid'
import { GardenCard } from './GardenCard'
import { LevelCard } from './LevelCard'
import { StreakCard } from './StreakCard'

// The progress board (S19): level, XP, streak and badges, in a quiet tone (spec 7.9): no confetti,
// no red. The garden leads (S33): it adds the exams and their tasks to GET /progress, and its one
// motion plays once when the screen opens. The rest comes from GET /progress; the board only shows it.
// The eye goes down the page in the order of weight: the garden, the level, the streak, the badges.
export function ProgressPage() {
  const progress = useProgress()
  const timeZone = useProfileTimezone()

  return (
    <div className="space-y-section">
      {/* Outside the loading condition: the h1 takes the focus after a navigation. */}
      <PageHeader title={en.progress.title} />
      {progress.isPending ? (
        <>
          {/* The garden's place, at its height (the scene is 360 x 160, at most 16rem high). Hidden,
              like the rows below: one "loading" is announced, by the card after it. */}
          <div aria-hidden="true" className="[&_[data-skeleton-card]]:aspect-[9/4] [&_[data-skeleton-card]]:max-h-64">
            <LoadingState shape="card" />
          </div>
          <LoadingState shape="card" />
          {/* The rows only draw the shape of the badges: one "loading" is announced, not two. */}
          <div aria-hidden="true">
            <LoadingState shape="list" rows={4} />
          </div>
        </>
      ) : progress.isError ? (
        <ErrorState
          message={errorMessage(progress.error)}
          onRetry={() => {
            void progress.refetch()
          }}
        />
      ) : (
        <>
          <GardenCard progress={progress.data} />
          <div className="grid gap-4 md:grid-cols-2">
            <LevelCard progress={progress.data} />
            <StreakCard progress={progress.data} />
          </div>
          <BadgeGrid progress={progress.data} />
          <ArchiveList archive={progress.data.archive} timeZone={timeZone} />
        </>
      )}
    </div>
  )
}
