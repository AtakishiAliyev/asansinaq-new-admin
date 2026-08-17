import { useEffect } from 'react'

const APP_NAME = 'Asansinaq Admin'

// Per-route browser-tab titles: with several tabs open, "Kitablar — Asansinaq
// Admin" is findable, a wall of identical titles is not.
export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — ${APP_NAME}` : APP_NAME
    return () => {
      document.title = APP_NAME
    }
  }, [title])
}
