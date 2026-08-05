import { createBrowserRouter } from 'react-router'
import { HomePage } from '@/app/home-page'
import { ProtectedLayout } from '@/app/protected-layout'
import { RootLayout } from '@/app/root-layout'
import { RouteError } from '@/app/route-error'
import { LoginPage } from '@/features/auth'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { path: 'login', element: <LoginPage />, errorElement: <RouteError /> },
      {
        element: <ProtectedLayout />,
        // Its own boundary, so a crash inside the admin area does not take
        // the whole tree down with it.
        errorElement: <RouteError />,
        children: [{ index: true, element: <HomePage /> }],
      },
    ],
  },
])
