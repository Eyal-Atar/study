import { Navigate, type RouteObject } from 'react-router'
import { AUTH_CALLBACK_PATH } from '../auth/AuthContext'
import { RequireAuth } from '../auth/RequireAuth'
import { AuthCallbackPage } from '../pages/AuthCallbackPage'
import { LoginPage } from '../pages/LoginPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { TodayPage } from '../pages/TodayPage'
import { AppShell } from './AppShell'

export const TODAY_PATH = '/today'

// main.tsx passes these to createBrowserRouter, and the tests to createMemoryRouter.
export const routes: RouteObject[] = [
  { path: '/login', Component: LoginPage },
  { path: AUTH_CALLBACK_PATH, Component: AuthCallbackPage },
  // Every child of this layout route needs a signed-in user, and renders inside the app shell.
  {
    Component: RequireAuth,
    children: [
      {
        Component: AppShell,
        children: [
          { index: true, element: <Navigate to={TODAY_PATH} replace /> },
          { path: TODAY_PATH, Component: TodayPage },
        ],
      },
    ],
  },
  { path: '*', Component: NotFoundPage },
]
