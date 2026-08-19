import { sanitizeSvg, svgNodeCount } from '@/core/figures/svg-safe'
import { eq, ok, suite } from '../harness.ts'

const parse = (svg: string) => sanitizeSvg(svg)

export const svgSafeSuite = suite('svg-safe', {
  'a geometry diagram survives intact'() {
    const { node, dropped } = parse(
      '<svg viewBox="0 0 400 300"><line x1="10" y1="10" x2="200" y2="80" stroke="currentColor"/>' +
        '<text x="12" y="24" font-size="14">A</text></svg>',
    )
    ok(node !== null)
    eq(node!.tag, 'svg')
    eq(node!.attrs.viewBox, '0 0 400 300')
    eq(node!.children.length, 2)
    eq(node!.children[1]!.text, 'A')
    eq(dropped.length, 0)
  },

  'a script element and everything inside it is removed'() {
    const { node, dropped } = parse(
      '<svg viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="2"/></svg>',
    )
    ok(node !== null)
    eq(node!.children.length, 1)
    eq(node!.children[0]!.tag, 'circle')
    ok(dropped.some((d) => d.includes('script')))
  },

  'event handler attributes never reach the tree'() {
    const { node, dropped } = parse(
      '<svg viewBox="0 0 10 10"><rect width="4" height="4" onload="alert(1)" onclick="x()"/></svg>',
    )
    eq(node!.children[0]!.attrs.onload, undefined)
    eq(node!.children[0]!.attrs.onclick, undefined)
    eq(node!.children[0]!.attrs.width, '4')
    ok(dropped.some((d) => d.toLowerCase().includes('onload')))
  },

  'references to anywhere but this document are refused'() {
    const { node } = parse(
      '<svg viewBox="0 0 10 10"><path d="M0 0" fill="url(https://evil.test/x)"/>' +
        '<line x1="0" y1="0" x2="1" y2="1" marker-end="url(#arrow)"/></svg>',
    )
    eq(node!.children[0]!.attrs.fill, undefined)
    eq(node!.children[1]!.attrs['marker-end'], 'url(#arrow)')
  },

  'href in any spelling is dropped'() {
    const { node } = parse(
      '<svg viewBox="0 0 10 10"><text href="javascript:alert(1)" xlink:href="#x" x="1" y="1">B</text></svg>',
    )
    const attrs = node!.children[0]!.attrs
    eq(attrs.href, undefined)
    eq(attrs['xlink:href'], undefined)
    eq(attrs.x, '1')
  },

  'markup hidden in a comment or CDATA is not resurrected'() {
    const { node } = parse(
      '<svg viewBox="0 0 10 10"><!-- <script>alert(1)</script> -->' +
        '<![CDATA[<script>alert(2)</script>]]><circle cx="1" cy="1" r="1"/></svg>',
    )
    eq(node!.children.length, 1)
    eq(node!.children[0]!.tag, 'circle')
  },

  'a fragment with no svg root is rejected rather than wrapped'() {
    const { node } = parse('<g><circle cx="1" cy="1" r="1"/></g>')
    eq(node, null)
  },

  'style is never kept — it is a second place to put a url'() {
    const { node } = parse(
      '<svg viewBox="0 0 10 10"><rect style="background:url(x)" width="2" height="2"/></svg>',
    )
    eq(node!.children[0]!.attrs.style, undefined)
  },

  'nesting is preserved so a group transform still applies'() {
    const { node } = parse(
      '<svg viewBox="0 0 10 10"><g transform="rotate(30)"><line x1="0" y1="0" x2="5" y2="5"/></g></svg>',
    )
    eq(node!.children[0]!.tag, 'g')
    eq(node!.children[0]!.attrs.transform, 'rotate(30)')
    eq(node!.children[0]!.children[0]!.tag, 'line')
    eq(svgNodeCount(node!), 3)
  },

  'an oversized payload is refused outright'() {
    const { node } = parse(`<svg viewBox="0 0 1 1">${'<line/>'.repeat(40000)}</svg>`)
    eq(node, null)
  },
})
