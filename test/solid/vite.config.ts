import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import { createSolidCompilerPlugin } from '../../packages/rari/src/vite/transform/solid-compiler'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Separate config from the root one: hydration needs solid-js's *browser*
// build (real `hydrate`, DOM helpers) under jsdom, while SSR needs the server
// build - one process can't resolve both, so SSR HTML is produced in a Node
// child process (see ssr-html.mjs) and hydrated here.
export default defineConfig({
  root,
  plugins: [createSolidCompilerPlugin({ hmr: false })],
  resolve: { conditions: ['solid', 'browser'] },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['test/solid/**/*.test.ts'],
    server: { deps: { inline: [/solid-js/, /seroval/] } },
  },
})
