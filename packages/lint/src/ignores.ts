export const ignorePatterns: string[] = [
  '**/target',
  '**/dist',
  '**/node_modules',
  '**/.pnpm-store/',
  '**/.build',
  '**/.cache',
  '**/coverage',
  '**/test-results',
  '**/playwright-report',
  'playwright/.cache',
  '**/tmp',
  // Hand-authored SSR-only fixtures (raw ssrElement calls, absolute file:// imports) that
  // are loaded by Rust tests through the module loader and aren't part of any TS project.
  '**/test/fixtures/solid-poc-app',
  '**/test/fixtures/solid-app/.tmp',
  '**/pnpm-lock.yaml',
  '**/CHANGELOG*.md',
  '**/LICENSE*',
]
