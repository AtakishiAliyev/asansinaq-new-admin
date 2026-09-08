import { useState } from 'react'
import {
  formatPages,
  parsePageRange,
  parsePagesLenient,
} from '@/core/segment/page-range'
import type { PDFDocumentProxy } from '@/features/import/lib/pdf'

// Questions and answer keys are different page sets — one shared input meant
// retyping the other every time you switched task. Clicking a thumbnail fills
// whichever field the operator last touched.
export function usePageRanges() {
  const [rangeInput, setRangeInput] = useState('')
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [keyRangeInput, setKeyRangeInput] = useState('')
  const [keyRangeError, setKeyRangeError] = useState<string | null>(null)
  const [activeRange, setActiveRange] = useState<'questions' | 'keys'>(
    'questions',
  )

  function reset(initialRange = '') {
    setRangeInput(initialRange)
    setRangeError(null)
    setKeyRangeInput('')
    setKeyRangeError(null)
    setActiveRange('questions')
  }

  /** The pages the active field names, leniently — what the strip highlights. */
  function activePages(doc: PDFDocumentProxy): Set<number> {
    return parsePagesLenient(
      activeRange === 'keys' ? keyRangeInput : rangeInput,
      doc.numPages,
    )
  }

  function toggleThumb(doc: PDFDocumentProxy, page: number) {
    const isKeys = activeRange === 'keys'
    const value = isKeys ? keyRangeInput : rangeInput
    const setValue = isKeys ? setKeyRangeInput : setRangeInput
    const setError = isKeys ? setKeyRangeError : setRangeError
    const strict = parsePageRange(value, doc.numPages)
    if (strict.ok || value.trim() === '') {
      const pages = parsePagesLenient(value, doc.numPages)
      if (pages.has(page)) pages.delete(page)
      else pages.add(page)
      setValue(formatPages([...pages]))
    } else {
      setValue(value.trim() ? `${value}, ${page}` : String(page))
    }
    setError(null)
  }

  return {
    rangeInput,
    setRangeInput,
    rangeError,
    setRangeError,
    keyRangeInput,
    setKeyRangeInput,
    keyRangeError,
    setKeyRangeError,
    activeRange,
    setActiveRange,
    reset,
    activePages,
    toggleThumb,
  }
}

export type PageRanges = ReturnType<typeof usePageRanges>
