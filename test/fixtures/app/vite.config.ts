import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { rari } from 'rari/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    rari({
      cacheControl: {
        routes: {
          '/headers-test': 'no-store',
        },
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
})
