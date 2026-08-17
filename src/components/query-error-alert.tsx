import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { normalizeError } from '@/lib/errors'

// Query failures are usually transient (network, expired session): every
// inline error surface offers a retry instead of a dead-end message.
export function QueryErrorAlert({
  error,
  onRetry,
  isRetrying,
}: {
  error: unknown
  onRetry: () => void
  isRetrying: boolean
}) {
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{normalizeError(error).message}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={isRetrying}
        >
          {isRetrying ? <Spinner data-icon="inline-start" /> : null}
          Yenidən cəhd et
        </Button>
      </AlertDescription>
    </Alert>
  )
}
