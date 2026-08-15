import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// ATLAS_TARGET=artifact produces a single self-contained HTML file (everything
// inlined, no external requests) for the hosted artifact / file:// use, and
// flips __ATLAS_HOSTED__ so the app knows the browser-direct AI calls are
// blocked by the sandbox CSP.
const artifact = process.env.ATLAS_TARGET === 'artifact'

export default defineConfig({
  plugins: [react(), ...(artifact ? [viteSingleFile()] : [])],
  define: {
    __ATLAS_HOSTED__: JSON.stringify(artifact),
  },
  server: { port: 5173, open: true },
})
