// Island fixture for the Solid migration's client-reference phase. A real
// build would mark this with a directive (reusing the existing 'use client'
// scan in packages/rari/src/vite/server/build.ts - see solid_islands.ts's
// doc comment); this hand-authored fixture skips that since there's no
// Solid JSX/directive toolchain yet, and is registered as an island
// directly by the test/caller instead.
//
// `onClick` proves this is meant to be interactive client-side (the whole
// reason it's an island and not plain server-only markup) - solid-js/web's
// ssrElement intentionally skips `on*` props during SSR (event handlers
// only attach during client hydration), so it has no effect on the
// server-rendered HTML, only on what a real browser would do after
// hydration.

import { ssrElement } from 'solid-js/web'

interface CounterProps {
  readonly label?: string
}

export default function Counter(props: CounterProps): unknown {
  return ssrElement(
    'button',
    { id: 'counter-island', onClick: () => {} },
    `${props.label ?? 'count'}: 0`,
    false,
  )
}
