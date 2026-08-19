import { lazy } from 'react'
import { createBrowserRouter } from 'react-router'
import { NotFoundPage } from '@/app/not-found-page'
import { ProtectedLayout } from '@/app/protected-layout'
import { RootLayout } from '@/app/root-layout'
import { RouteError } from '@/app/route-error'
import { Shell } from '@/components/layout/shell'
import { LoginPage } from '@/features/auth'
// Not lazy: the sidebar reads the profile on every page, so the feature is in
// the eager graph regardless — splitting its page would only add a round trip.
import { ProfilePage } from '@/features/profile'

// Only the login page ships in the entry bundle — it is what an unauthenticated
// visitor loads, and it needs none of what the rest of the panel drags in
// (pdf.js for import, KaTeX and mathjs for question rendering). Each page below
// arrives on its first visit; the Suspense boundary lives in the Shell, so the
// sidebar stays on screen while a chunk loads.
const DashboardPage = lazy(async () => ({
  default: (await import('@/features/dashboard')).DashboardPage,
}))
const ImportPage = lazy(async () => ({
  default: (await import('@/features/import')).ImportPage,
}))
const BooksPage = lazy(async () => ({
  default: (await import('@/features/books')).BooksPage,
}))
const QuestionsPage = lazy(async () => ({
  default: (await import('@/features/questions')).QuestionsPage,
}))
const TaxonomyPage = lazy(async () => ({
  default: (await import('@/features/taxonomy')).TaxonomyPage,
}))
const OpsPage = lazy(async () => ({
  default: (await import('@/features/ops')).OpsPage,
}))

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
              { index: true, element: <DashboardPage /> },
              { path: 'import', element: <ImportPage /> },
              { path: 'books', element: <BooksPage /> },
              { path: 'questions', element: <QuestionsPage /> },
              { path: 'taxonomy', element: <TaxonomyPage /> },
              { path: 'ops', element: <OpsPage /> },
              { path: 'profile', element: <ProfilePage /> },
              // Unknown paths land inside the shell, one click from the nav.
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
])
