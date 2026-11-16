import { Navigate, type RouteObject } from 'react-router'
import { AUTH_CALLBACK_PATH } from '../auth/AuthContext'
import { RequireAuth } from '../auth/RequireAuth'
import { ExamPage } from '../exam/ExamPage'
import { ExamsPage } from '../exam/ExamsPage'
import { AuthCallbackPage } from '../pages/AuthCallbackPage'
import { LoginPage } from '../pages/LoginPage'
import { onboardingRoutes } from '../onboarding/routes'
import { NotFoundPage } from '../pages/NotFoundPage'
import { TodayPage } from '../pages/TodayPage'
import { WeekPage } from '../week/WeekPage'
import { DeleteAccountPage } from '../settings/DeleteAccountPage'
import { GoodbyePage } from '../settings/GoodbyePage'
import { SettingsPage } from '../settings/SettingsPage'
import { AppShell } from './AppShell'
import { OnboardingGate } from './OnboardingGate'

export const TODAY_PATH = '/today'
export const WEEK_PATH = '/week'
export const EXAMS_PATH = '/exams'
export const SETTINGS_PATH = '/settings'
export const DELETE_ACCOUNT_PATH = '/settings/delete-account'
// Outside RequireAuth: the page a deleted account lands on, signed out.
export const GOODBYE_PATH = '/goodbye'

// main.tsx passes these to createBrowserRouter, and the tests to createMemoryRouter.
export const routes: RouteObject[] = [
  { path: '/login', Component: LoginPage },
  { path: AUTH_CALLBACK_PATH, Component: AuthCallbackPage },
  { path: GOODBYE_PATH, Component: GoodbyePage },
  // Every child of this layout route needs a signed-in user, and renders inside the app shell.
  // OnboardingGate sends a user without a plan to the onboarding, and one with a plan away from it.
  {
    Component: RequireAuth,
    children: [
      {
        Component: AppShell,
        children: [
          {
            Component: OnboardingGate,
            children: [
              { index: true, element: <Navigate to={TODAY_PATH} replace /> },
              { path: TODAY_PATH, Component: TodayPage },
              { path: WEEK_PATH, Component: WeekPage },
              { path: EXAMS_PATH, Component: ExamsPage },
              { path: `${EXAMS_PATH}/:examId`, Component: ExamPage },
              { path: SETTINGS_PATH, Component: SettingsPage },
              { path: DELETE_ACCOUNT_PATH, Component: DeleteAccountPage },
              ...onboardingRoutes,
            ],
          },
        ],
      },
    ],
  },
  { path: '*', Component: NotFoundPage },
]
