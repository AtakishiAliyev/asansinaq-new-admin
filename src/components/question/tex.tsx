import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { normalizeTex } from '@/core/questions/tex-normalize'

interface TexProps {
  tex: string
  display?: boolean
  className?: string
}

export function Tex({ tex, display = false, className }: TexProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(normalizeTex(tex), {
        displayMode: display,
        throwOnError: false,
        strict: false,
        output: 'html',
      })
    } catch {
      return `<span style="color:#c0392b">${tex}</span>`
    }
  }, [tex, display])

  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

// texCompiles (the lint-layer validity check) lives in
// '@/core/questions/tex-normalize' — import it from there, not here.

// Render mixed markdown-ish stem text: split on $...$ / $$...$$ and render the
// math spans with KaTeX, keeping the prose as plain text.
export function StemText({ text }: { text: string }) {
  const parts = useMemo(() => splitMath(text), [text])
  return (
    <span>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          <span key={i} className="whitespace-pre-wrap">
            {p.value}
          </span>
        ) : (
          <Tex key={i} tex={p.value} display={p.display} />
        ),
      )}
    </span>
  )
}

type Part = { kind: 'text'; value: string } | { kind: 'math'; value: string; display: boolean }

function splitMath(text: string): Part[] {
  const parts: Part[] = []
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', value: text.slice(last, m.index) })
    if (m[1] !== undefined) parts.push({ kind: 'math', value: m[1], display: true })
    // Two alternatives, one group each: m[1] absent means m[2] matched.
    else parts.push({ kind: 'math', value: m[2]!, display: false })
    last = re.lastIndex
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) })
  return parts
}
