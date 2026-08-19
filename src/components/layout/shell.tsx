import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Spinner } from '@/components/ui/spinner'

// The pages are code-split (router.tsx), so the first visit to one waits on a
// chunk. The boundary sits INSIDE the shell: the sidebar and header stay put
// while the page arrives, instead of the whole frame blinking out.
function PageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner />
    </div>
  )
}

export function Shell() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4 md:hidden">
          <SidebarTrigger />
          <span className="text-sm font-medium">Asansinaq</span>
        </header>
        <div className="flex-1 p-6">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
