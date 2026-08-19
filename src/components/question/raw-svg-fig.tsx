import { createElement, type ReactNode } from 'react'
import type { SvgNode } from '@/core/figures/svg-safe'

// Renders the sanitized tree as React elements.
//
// Deliberately not `dangerouslySetInnerHTML`: the tree has already passed an
// allowlist, but building elements means the markup the model wrote never
// exists as a string the browser parses. Even a hole in the allowlist yields a
// useless element rather than an executed one.

// React renders hyphenated SVG attributes correctly but warns about each one,
// which would put four "Invalid DOM property" lines in the console for every
// figure and bury real warnings. The DOM spelling is camelCase.
const RENAME: Record<string, string> = { class: 'className' }

function reactName(name: string): string {
  if (RENAME[name]) return RENAME[name]
  return name.includes('-')
    ? name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    : name
}

function toProps(node: SvgNode, key: number): Record<string, unknown> {
  const props: Record<string, unknown> = { key }
  for (const [name, value] of Object.entries(node.attrs)) {
    props[reactName(name)] = value
  }
  return props
}

function render(node: SvgNode, key = 0): ReactNode {
  const children: ReactNode[] = node.children.map((c, i) => render(c, i))
  // Text belongs to <text>/<tspan>; React escapes it, so a label can say
  // anything without becoming markup.
  const content: ReactNode[] = node.text
    ? [node.text, ...children]
    : children
  return createElement(
    node.tag,
    toProps(node, key),
    content.length ? content : undefined,
  )
}

export function RawSvgFig({ node }: { node: SvgNode }) {
  // The model is told to emit a viewBox; width/height are ours to decide so
  // the figure scales with the question rather than with what it guessed.
  const root: SvgNode = {
    ...node,
    attrs: {
      ...node.attrs,
      width: '100%',
      height: '100%',
      ...(node.attrs.viewBox ? {} : { viewBox: '0 0 400 300' }),
    },
  }
  return (
    <div className="text-foreground mx-auto w-full max-w-md [&_svg]:h-auto [&_svg]:w-full">
      {render(root)}
    </div>
  )
}
