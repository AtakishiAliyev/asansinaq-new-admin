import { useQueries } from '@tanstack/react-query'
import { signImageUrls } from '@/features/questions'
import { examKeys } from '@/features/exams/api/keys'
import type { BuilderQuestion } from '@/features/exams/schemas'
import { imagePathsOf } from '@/features/exams/lib/question'

// Signed URLs for the images of every loaded page, one request per page.
//
// Per page rather than for the whole list: a page's rows never change once
// loaded, so its signatures are fetched once and kept, and scrolling on
// fetches a page more rather than re-signing everything above it. One map
// over the whole list would re-key on every new page and blank the pictures
// already on screen while it re-signed them.
export function useSignedPages(pages: BuilderQuestion[][]) {
  return useQueries({
    queries: pages.map((page) => {
      const paths = [...new Set(page.flatMap(imagePathsOf))].sort()
      return {
        queryKey: examKeys.signed(paths.join('|')),
        queryFn: () => signImageUrls(paths),
        enabled: paths.length > 0,
        staleTime: 30 * 60_000,
      }
    }),
    combine: (results) => {
      const merged = new Map<string, string>()
      for (const r of results)
        for (const [k, v] of r.data ?? []) merged.set(k, v)
      return merged
    },
  })
}
