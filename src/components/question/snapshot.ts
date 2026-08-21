// Browser-only: render a DSL FigureDoc to a PNG data URL so render-and-compare
// can check it against the original crop. Mounts <FigureRenderer> in an
// offscreen container, waits for KaTeX webfonts, then snapshots via html-to-image.

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { toPng } from 'html-to-image'
import type { FigureDoc } from '@/core/figures/figspec'
import type { SvgNode } from '@/core/figures/svg-safe'
import { FigureRenderer } from './figure-renderer'

export async function snapshotFigure(
  doc: FigureDoc,
  resolveImageUrl?: (src: string) => string,
  /**
   * A definite width for the offscreen host.
   *
   * Required for anything whose renderer sizes itself in percentages. The host
   * shrink-wraps its content, and a child asking for `width: 100%` of a
   * shrink-wrapped parent resolves to zero — the figure renders into a box with
   * no width and the snapshot comes back blank. That is not a hypothetical:
   * every SVG the agent drew was rejected as an empty render, simple ones
   * included, because the drawing never had a width to be painted into.
   */
  widthPx?: number,
): Promise<string> {
  const host = document.createElement('div')
  host.style.cssText = widthPx
    ? `position:fixed;left:-99999px;top:0;background:#fff;padding:12px;display:block;width:${widthPx}px`
    : 'position:fixed;left:-99999px;top:0;background:#fff;padding:12px;display:inline-block'
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    root.render(createElement(FigureRenderer, { doc, resolveImageUrl }))
    // let React paint + KaTeX fonts load
    await new Promise((r) => setTimeout(r, 60))
    if (document.fonts?.ready) await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    return await toPng(host, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true })
  } finally {
    root.unmount()
    host.remove()
  }
}

// `currentColor` is right in the app — it lets a figure read in either theme —
// and wrong the moment the figure is rendered off-screen to be saved. There
// the colour resolves against a cloned context with no theme variables, and
// the first agent figure came back 648x348 of pure white: navy strokes turned
// white, on white. A stored image has no theme to be aware of, so the ink is
// made concrete before it is painted.
const SNAPSHOT_INK = '#1e3a5f'

function withConcreteInk(node: SvgNode): SvgNode {
  const attrs: Record<string, string> = {}
  for (const [k, v] of Object.entries(node.attrs)) {
    attrs[k] = v === 'currentColor' ? SNAPSHOT_INK : v
  }
  return {
    ...node,
    attrs,
    children: node.children.map(withConcreteInk),
  }
}

/**
 * The same, for a single sanitized SVG tree. The agent draws one figure at a
 * time and has to see it immediately; wrapping it in a FigureDoc first would
 * only be ceremony.
 */
export async function snapshotSvgNode(node: SvgNode): Promise<string> {
  return snapshotFigure(
    { v: 1, items: [{ kind: 'raw_svg', node: withConcreteInk(node) }] },
    undefined,
    SVG_SNAPSHOT_WIDTH,
  )
}

/**
 * `max-w-md` (448px) in RawSvgFig plus this host's 12px padding either side.
 *
 * Matched so the figure fills the snapshot instead of sitting centred in white
 * margin. If that cap ever changes the cost is wasted white space, not a blank
 * image — the only thing that must stay true is that the width is definite.
 * At pixelRatio 2 this lands at ~900px of real pixels, enough for small labels.
 */
const SVG_SNAPSHOT_WIDTH = 448 + 24
