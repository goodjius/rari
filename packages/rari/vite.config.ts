import path from 'node:path'
import { defineConfig } from 'vite-plus'
import { monorepoFmt, monorepoLint } from '../../.config/lint/monorepo'

export default defineConfig({
  fmt: monorepoFmt,
  lint: monorepoLint,
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  pack: {
    entry: {
      'index': 'src/index.ts',
      'router': 'src/router/index.ts',
      'vite': 'src/vite/index.ts',
      'cli': 'src/cli/index.ts',
      'platform': 'src/cli/platform.ts',
      'image': 'src/image/index.ts',
      'font': 'src/font/index.ts',
      'font/local': 'src/font/local.ts',
      'font/google': 'src/font/google.ts',
      'og': 'src/og/index.ts',
      'mdx': 'src/mdx/index.ts',
      'mdx/define': 'src/mdx/define.ts',
      'mdx/registry': 'src/mdx/registry.ts',
      'headers': 'src/headers.ts',
      'runtime/solid-call-server': 'src/runtime/actions/solid-call-server.ts',
      'runtime/action-revalidation-kind': 'src/runtime/actions/revalidation-kind.ts',
      'runtime/entry-client-solid': 'src/runtime/entry-client-solid.ts',
      'proxy/runtime-executor': 'src/proxy/runtime/runtime-executor.ts',
      'proxy/RariRequest': 'src/proxy/http/request.ts',
      'proxy/RariResponse': 'src/proxy/http/response.ts',
    },
    minify: true,
    deps: {
      neverBundle: [
        '@mdx-js/mdx',
        '@capsizecss/metrics',
        '@capsizecss/unpack',
        'vite',
        'vite-plus',
        '@babel/core',
        'babel-preset-solid',
        'seroval',
        'solid-js',
        'solid-js/web',
        'solid-js/store',
        'solid-refresh/babel',
        'rari/router',
        'rari/mdx/registry',
        'rari/mdx/define',
      ],
    },
  },
})
