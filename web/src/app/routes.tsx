import type { RouteObject } from 'react-router'
import { AUTH_CALLBACK_PATH } from '../auth/AuthContext'
import { RequireAuth } from '../auth/RequireAuth'
import { AuthCallbackPage } from '../pages/AuthCallbackPage'
import { HomePage } from '../pages/HomePage'
import { LoginPage } from '../pages/LoginPage'
import { NotFoundPage } from '../pages/NotFoundPage'

// main.tsx passes these to createBrowserRouter, and the tests to createMemoryRouter.
export const routes: RouteObject[] = [
  { path: '/login', Component: LoginPage },
  { path: AUTH_CALLBACK_PATH, Component: AuthCallbackPage },
  // Every child of this layout route needs a signed-in user.
  { Component: RequireAuth, children: [{ index: true, Component: HomePage }] },
  { path: '*', Component: NotFoundPage },
]
