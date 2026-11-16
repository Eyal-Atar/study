import { Navigate, type RouteObject } from 'react-router'
import { AUTH_CALLBACK_PATH } from '../auth/AuthContext'
import { RequireAuth } from '../auth/RequireAuth'
import { ExamPage } from '../exam/ExamPage'
import { ExamsPage } from '../exam/ExamsPage'
import { ProgressPage } from '../progress/ProgressPage'
import { AuthCallbackPage } from '../pages/AuthCallbackPage'
import { LoginPage } from '../pages/LoginPage'
import { onboardingRoutes } from '../onboarding/routes'
import { NotificationsPage } from '../notifications/NotificationsPage'
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
export const PROGRESS_PATH = '/progress'
export const DELETE_ACCOUNT_PATH = '/settings/delete-account'
// Outside RequireAuth: the page a deleted account lands on, signed out.
export const GOODBYE_PATH = '/goodbye'
// The same value as notifications/paths.ts (a literal here, for fast refresh; AppShell.test checks they match).
export const NOTIFICATIONS_PATH = '/settings/notifications'

// Only in the dev build: Vite replaces import.meta.env.DEV with false in a production build, so the
// branch, the import() and the page's chunk are all dropped. Outside RequireAuth, so the page opens
// without signing in and without data.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/components',
        lazy: async () => ({ Component: (await import('../dev/ComponentsPage')).ComponentsPage }),
      },
    ]
  : []

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
              { path: PROGRESS_PATH, Component: ProgressPage },
              { path: SETTINGS_PATH, Component: SettingsPage },
              { path: DELETE_ACCOUNT_PATH, Component: DeleteAccountPage },
              { path: NOTIFICATIONS_PATH, Component: NotificationsPage },
              ...onboardingRoutes,
            ],
          },
        ],
      },
    ],
  },
  ...devRoutes,
  { path: '*', Component: NotFoundPage },
]
