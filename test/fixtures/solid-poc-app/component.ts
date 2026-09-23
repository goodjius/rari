// Fixture component for the Solid PoC (React -> SolidJS migration, first
// slice). Written against solid-js/web's low-level `ssrElement` instead of
// JSX, so this slice doesn't need a Solid JSX compiler wired into the build
// toolchain - see the Solid PoC plan for why that's deferred.
//
// Not solid-js/h: that package is DOM-only (calls `document.createElement`
// directly - confirmed empirically, it throws `document is not defined`
// under V8/deno_core, which has no DOM). `ssrElement` is what Solid's own
// JSX compiler actually lowers server-side JSX to, so it's the genuine
// SSR-safe primitive; hand-authoring against it means this fixture is
// SSR-only (real Solid apps get a JSX-compiled client build for hydration
// from the *same* source via the compiler's dual output, which this slice
// doesn't have - client hydration in entry-client-solid.ts remains an
// unexercised template for that reason).
//
// Not yet wired into the live rari CLI/Vite dev-server pipeline: this file
// is loaded directly by the module loader (crates/rari/src/runtime/module_loader)
// via the new solid_vendor.rs resolution and the solid_rsc_renderer.ts /
// solid_streaming.ts scripts (crates/rari/src/rendering/{base,layout}/js/),
// not through `rari dev`/`rari build`.

import { ssrElement } from 'solid-js/web'

export default function SolidPocApp(): unknown {
  return ssrElement('div', { id: 'solid-poc' }, 'Hello from Solid', false)
}
