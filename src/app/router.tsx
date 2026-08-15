import { createBrowserRouter, Navigate } from 'react-router'
import { ProtectedLayout } from '@/app/protected-layout'
import { RootLayout } from '@/app/root-layout'
import { RouteError } from '@/app/route-error'
import { Shell } from '@/components/layout/shell'
import { LoginPage } from '@/features/auth'
import { BooksPage } from '@/features/books'
import { ImportPage } from '@/features/import'
import { ProfilePage } from '@/features/profile'
import { TaxonomyPage } from '@/features/taxonomy'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { path: 'login', element: <LoginPage />, errorElement: <RouteError /> },
      {
        element: <ProtectedLayout />,
        errorElement: <RouteError />,
        children: [
          {
            element: <Shell />,
            children: [
              { index: true, element: <Navigate to="/import" replace /> },
              { path: 'import', element: <ImportPage /> },
              { path: 'books', element: <BooksPage /> },
              { path: 'taxonomy', element: <TaxonomyPage /> },
              { path: 'profile', element: <ProfilePage /> },
            ],
          },
        ],
      },
    ],
  },
])
