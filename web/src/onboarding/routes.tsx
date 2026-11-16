import { Navigate, type RouteObject } from 'react-router'
import { BuildingStep } from './BuildingStep'
import { ExamsStep } from './ExamsStep'
import { MaterialsStep } from './MaterialsStep'
import { ScheduleStep } from './ScheduleStep'
import { STEP_PATHS } from './steps'

// The onboarding steps, one URL each (S13 decision 2). app/routes.tsx puts them behind the
// OnboardingGate, which sends a user who finished the onboarding to /today.
export const onboardingRoutes: RouteObject[] = [
  { path: '/onboarding', element: <Navigate to={STEP_PATHS.exams} replace /> },
  { path: STEP_PATHS.exams, Component: ExamsStep },
  { path: STEP_PATHS.materials, Component: MaterialsStep },
  { path: STEP_PATHS.schedule, Component: ScheduleStep },
  { path: STEP_PATHS.building, Component: BuildingStep },
]
