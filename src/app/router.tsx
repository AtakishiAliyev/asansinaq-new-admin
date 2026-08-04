import { createBrowserRouter } from 'react-router'
import { HomePage } from '@/app/home-page'
import { RootLayout } from '@/app/root-layout'
import { RouteError } from '@/app/route-error'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [{ index: true, element: <HomePage /> }],
  },
])
