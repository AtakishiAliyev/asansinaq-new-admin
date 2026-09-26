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
const ReadyPage = lazy(async () => ({
  default: (await import('@/features/questions')).ReadyPage,
}))
const TaxonomyPage = lazy(async () => ({
  default: (await import('@/features/taxonomy')).TaxonomyPage,
}))
const OpsPage = lazy(async () => ({
  default: (await import('@/features/ops')).OpsPage,
}))
const ExamsPage = lazy(async () => ({
  default: (await import('@/features/exams')).ExamsPage,
}))
const ExamBuilderPage = lazy(async () => ({
  default: (await import('@/features/exams')).ExamBuilderPage,
}))
const RoadmapsPage = lazy(async () => ({
  default: (await import('@/features/roadmaps')).RoadmapsPage,
}))
const RoadmapBuilderPage = lazy(async () => ({
  default: (await import('@/features/roadmaps')).RoadmapBuilderPage,
}))
const AnalyticsPage = lazy(async () => ({
  default: (await import('@/features/analytics')).AnalyticsPage,
}))
const DenemeAnalyticsPage = lazy(async () => ({
  default: (await import('@/features/analytics')).DenemeAnalyticsPage,
}))
const RoadmapAnalyticsPage = lazy(async () => ({
  default: (await import('@/features/analytics')).RoadmapAnalyticsPage,
}))
const TemplatesPage = lazy(async () => ({
  default: (await import('@/features/exams')).TemplatesPage,
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
              { path: 'ready', element: <ReadyPage /> },
              { path: 'taxonomy', element: <TaxonomyPage /> },
              { path: 'ops', element: <OpsPage /> },
              { path: 'exams', element: <ExamsPage /> },
              // Before the id route, or "templates" would be read as an id.
              { path: 'exams/templates', element: <TemplatesPage /> },
              { path: 'roadmaps', element: <RoadmapsPage /> },
              {
                path: 'roadmaps/analytics/:roadmapId',
                element: <RoadmapAnalyticsPage />,
              },
              { path: 'roadmaps/:roadmapId', element: <RoadmapBuilderPage /> },
              { path: 'exams/analytics', element: <AnalyticsPage /> },
              {
                path: 'exams/analytics/:examId',
                element: <DenemeAnalyticsPage />,
              },
              { path: 'exams/:examId', element: <ExamBuilderPage /> },
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
