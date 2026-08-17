// pdf.js v6 decodes JBIG2/JPX scan layers in wasm and loads the binaries from
// a URL at runtime. Vite cannot serve node_modules, so the wasm files are
// copied into public/ on install. Without them, scanned pages render with the
// text layer silently missing.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'node_modules/pdfjs-dist/wasm')
const dest = join(root, 'public/pdfjs/wasm')
mkdirSync(dest, { recursive: true })
for (const file of readdirSync(src)) {
  copyFileSync(join(src, file), join(dest, file))
}
console.log(`pdfjs wasm → public/pdfjs/wasm (${readdirSync(src).length} files)`)
