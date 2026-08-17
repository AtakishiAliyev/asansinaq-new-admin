import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty'
import { usePageTitle } from '@/hooks/use-page-title'

// Unknown paths inside the shell: the sidebar stays, the user is one click
// from anywhere useful — unlike the bare root error boundary.
export function NotFoundPage() {
  usePageTitle('Səhifə tapılmadı')
  return (
    <Empty className="min-h-[60vh]">
      <EmptyTitle>Səhifə tapılmadı</EmptyTitle>
      <EmptyDescription>
        Bu ünvanda heç nə yoxdur. Soldakı menyudan davam edin.
      </EmptyDescription>
      <Button asChild>
        <Link to="/">İcmala qayıt</Link>
      </Button>
    </Empty>
  )
}
