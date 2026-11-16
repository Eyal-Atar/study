import { Navigate, type RouteObject } from 'react-router'
import { AUTH_CALLBACK_PATH } from '../auth/AuthContext'
import { RequireAuth } from '../auth/RequireAuth'
import { AuthCallbackPage } from '../pages/AuthCallbackPage'
import { LoginPage } from '../pages/LoginPage'
import { onboardingRoutes } from '../onboarding/routes'
import { NotFoundPage } from '../pages/NotFoundPage'
import { TodayPage } from '../pages/TodayPage'
import { AppShell } from './AppShell'
import { OnboardingGate } from './OnboardingGate'

export const TODAY_PATH = '/today'

// main.tsx passes these to createBrowserRouter, and the tests to createMemoryRouter.
export const routes: RouteObject[] = [
  { path: '/login', Component: LoginPage },
  { path: AUTH_CALLBACK_PATH, Component: AuthCallbackPage },
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
              ...onboardingRoutes,
            ],
          },
        ],
      },
    ],
  },
  { path: '*', Component: NotFoundPage },
]
