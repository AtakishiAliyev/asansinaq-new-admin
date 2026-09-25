import { useEffect, useState } from 'react'

/** The value, once it has stopped changing for `delay` ms — for search
 *  boxes, so each keystroke does not become a query. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return settled
}
