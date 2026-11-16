import { Navigate, Outlet, useLocation } from 'react-router'
import { errorMessage } from '../api/client'
import { useMe, useUserId } from '../api/me'
import { he } from '../i18n/he'
import { rememberedJob } from '../onboarding/activeJob'
import { STEP_PATHS } from '../onboarding/steps'
import { Button } from '../ui/Button'

const ONBOARDING_PATH = '/onboarding'

function underOnboarding(pathname: string): boolean {
  return pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`)
}

// Decides between the onboarding and the app, from GET /me (S13 decision 1: the API sets
// onboarding_completed_at when the first plan is written). A user without a plan goes to the
// onboarding; a user with one never sees it again. The one exception is the building screen of a
// job (?job=): it is where the plan was just written, and it shows that job's summary.
// A user without a plan whose job still runs (BuildingStep remembers it in sessionStorage) goes from
// / or /onboarding back to that job's building screen; a step they open themselves stays.
export function OnboardingGate() {
  const me = useMe()
  const userId = useUserId()
  const { pathname, search } = useLocation()

  if (me.isPending) {
    return (
      <p role="status" className="text-ink-muted">
        {he.common.loading}
      </p>
    )
  }
  if (me.isError) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="text-danger">
          {errorMessage(me.error)}
        </p>
        <Button
          onPress={() => {
            void me.refetch()
          }}
        >
          {he.common.retry}
        </Button>
      </div>
    )
  }

  const inOnboarding = underOnboarding(pathname)
  if (me.data.onboarding_completed_at === null) {
    if (!inOnboarding || pathname === ONBOARDING_PATH) {
      const jobId = rememberedJob(userId)
      const to = jobId === null ? STEP_PATHS.exams : `${STEP_PATHS.building}?job=${encodeURIComponent(jobId)}`
      return <Navigate to={to} replace />
    }
  } else if (inOnboarding) {
    const showingJob = pathname === STEP_PATHS.building && new URLSearchParams(search).has('job')
    if (!showingJob) return <Navigate to="/today" replace />
  }
  return <Outlet />
}
