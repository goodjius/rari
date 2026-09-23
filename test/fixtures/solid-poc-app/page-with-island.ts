// Page fixture for the Solid migration's client-reference phase: mixes
// plain server-only markup with one nested island (counter-island.ts),
// proving server-only content and island content coexist correctly in one
// render. Calls the global `renderSolidIsland` directly (see
// crates/rari/src/rendering/base/js/solid_islands.ts) since there's no
// Solid JSX/directive-compiler toolchain yet to generate this wiring.
//
// The import below uses the island's absolute registered specifier, not a
// relative one - modules injected via `add_module_to_loader` (as these test
// fixtures are, rather than loaded from a real on-disk path the loader
// already knows) don't carry a resolvable base URL for relative imports
// (`Invalid URL: relative URL without a base`, confirmed empirically). A
// real build's own module graph wouldn't have this constraint.
//
// The island is registered by the test under this exact specifier, so
// `moduleId` below matches what a client would need to re-import to
// hydrate it.

import Counter from 'file:///rari_component/counter-island.ts'
import { ssrElement } from 'solid-js/web'

type RenderSolidIsland = (
  component: (props: unknown) => unknown,
  props: unknown,
  meta: { moduleId: string; exportName: string },
) => unknown

export default function PageWithIsland(): unknown {
  const renderSolidIsland = (globalThis as unknown as { renderSolidIsland: RenderSolidIsland })
    .renderSolidIsland

  const island = renderSolidIsland(
    Counter as unknown as (props: unknown) => unknown,
    { label: 'clicks' },
    {
      moduleId: 'file:///rari_component/counter-island.ts',
      exportName: 'default',
    },
  )

  return ssrElement('div', { id: 'page-with-island' }, ['server-only content', island], false)
}
