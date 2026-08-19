import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // The questions chunk carries KaTeX and mathjs because the review
    // workbench renders real questions. It is code-split and only loads on the
    // pages that need it, so its size is a fact, not a defect — but the
    // default 500 kB warning fired on every build and had stopped being read.
    // 1600 kB keeps the alarm meaningful: it goes off if that chunk grows.
    chunkSizeWarningLimit: 1600,
  },
})
