import { useCallback, useEffect, useState } from 'react'

// Supabase refuses a second email to the same address within smtp_max_frequency
// seconds, so the resend button counts down instead of failing. Counting from a
// deadline rather than by decrementing keeps it honest when the tab is
// backgrounded and timers get throttled.
export function useCooldown(seconds: number) {
  const [deadline, setDeadline] = useState(0)
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (deadline === 0) return
    const id = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= deadline) clearInterval(id)
    }, 250)
    return () => clearInterval(id)
  }, [deadline])

  const start = useCallback(() => {
    const current = Date.now()
    setNow(current)
    setDeadline(current + seconds * 1000)
  }, [seconds])

  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))

  return { remaining, isCoolingDown: remaining > 0, start }
}
