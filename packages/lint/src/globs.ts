/**
 * Files authored against Solid rather than React. React lint rules (hooks,
 * React Compiler-derived rules, `jsx-key`, ...) are wrong for Solid's
 * fine-grained reactivity, so they are switched off here and
 * `eslint-plugin-solid` is applied instead. Everything else stays React
 * until the migration finishes.
 *
 * Convention: a directory named `solid-*` under test/fixtures, `test/solid`,
 * or any `*.solid.{ts,tsx}` / `*-solid.{ts,tsx}` file.
 */
export const solidGlobs: string[] = [
  '**/test/fixtures/solid-*/**/*.{ts,tsx}',
  '**/test/solid/**/*.{ts,tsx}',
  '**/*.solid.{ts,tsx}',
  '**/*-solid.{ts,tsx}',
]

/** Rules of the oxlint/ESLint `react/*` block that don't apply to Solid. */
export const reactOnlyRules: readonly string[] = [
  'exhaustive-deps',
  'jsx-key',
  'no-array-index-key',
  'no-children-prop',
  'no-clone-element',
  'no-danger-with-children',
  'no-direct-mutation-state',
  'no-unstable-nested-components',
  'error-boundaries',
  'globals',
  'immutability',
  'incompatible-library',
  'preserve-manual-memoization',
  'purity',
  'refs',
  'set-state-in-effect',
  'set-state-in-render',
  'static-components',
  'use-memo',
  'unsupported-syntax',
  'rules-of-hooks',
  'only-export-components',
]
