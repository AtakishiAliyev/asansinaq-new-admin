import { supabase } from '@/lib/supabase'
import { scanDetectionSchema, type ScanDetection } from '@/core/segment/scan'

// Asks the detect-questions Edge Function where the questions are on a scanned
// page. The Gemini key lives in function secrets; the browser never sees it.
export async function detectQuestions(
  base64: string,
  mime: 'image/jpeg' | 'image/png',
): Promise<ScanDetection> {
  const { data, error } = await supabase.functions.invoke('detect-questions', {
    body: { image: base64, mime },
  })
  if (error) {
    // The function returns structured errors; surface its message (and any
    // diagnostic detail) when present. On network-level failures `context` is
    // NOT a Response — guard, or the error text becomes a TypeError string.
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      const body = await context.json().catch(() => null)
      if (body && typeof body.error === 'string') {
        throw new Error(
          body.detail
            ? `${body.error} — ${String(body.detail).slice(0, 140)}`
            : body.error,
        )
      }
    }
    throw error
  }
  return scanDetectionSchema.parse(data)
}
