import { Navigate, Outlet, useLocation } from 'react-router'
import { errorMessage } from '../api/client'
import { useMe, useUserId } from '../api/me'
import { rememberedJob } from '../onboarding/activeJob'
import { STEP_PATHS } from '../onboarding/steps'
import { ErrorState, LoadingState } from '../ui/states'

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

  // The gate is part of the shell: every screen waits behind it, in the shape of a screen.
  if (me.isPending) return <LoadingState shape="card" />
  if (me.isError) {
    return (
      <ErrorState
        message={errorMessage(me.error)}
        onRetry={() => {
          void me.refetch()
        }}
      />
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
