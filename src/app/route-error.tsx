import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import { usePageTitle } from '@/hooks/use-page-title'

export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404
  usePageTitle(notFound ? 'Səhifə tapılmadı' : 'Xəta')

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {notFound ? 'Səhifə tapılmadı' : 'Nəsə səhv getdi'}
      </h1>
      <p className="text-muted-foreground max-w-sm text-center text-sm">
        {notFound
          ? 'Axtardığınız ünvan mövcud deyil və ya dəyişdirilib.'
          : 'Gözlənilməz xəta baş verdi. Səhifəni yeniləyin; təkrarlanarsa, yenidən daxil olun.'}
      </p>
      <div className="flex gap-2">
        <Button asChild>
          <Link to="/">Əsas səhifəyə qayıt</Link>
        </Button>
        {!notFound ? (
          <Button variant="outline" onClick={() => window.location.reload()}>
            Yenilə
          </Button>
        ) : null}
      </div>
    </div>
  )
}
