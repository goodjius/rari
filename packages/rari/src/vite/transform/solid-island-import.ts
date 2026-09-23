import type { ScannedImport } from '../analysis/directives'

/**
 * Solid's analog of React's client-reference replacement (client-import.ts).
 *
 * React swaps a `'use client'` import for a `registerClientReference` stub
 * so the client component's code never loads on the server. Solid has no
 * serialize-and-skip mechanism: every component is a plain function, and the
 * island still needs real SSR HTML for the initial paint. So the import is
 * kept (the module compiles with `generate: 'ssr'` in server environments)
 * and each imported binding is wrapped so that rendering it goes through the
 * runtime's `renderSolidIsland` (crates/rari/src/rendering/base/js/solid_islands.ts):
 * it adds the `data-rari-island` anchor, mints the hydration `renderId`, and
 * emits the row the browser uses to hydrate just that subtree. Exclusion from
 * the client bundle still happens through the build graph, exactly as for
 * React - only the islands get client entry points.
 *
 * Namespace imports (`import * as X`) are left untouched: there is no single
 * component to wrap.
 */
export interface SolidIslandReplacement {
  readonly code: string
}

function wrapperFor(local: string, implLocal: string, moduleId: string, exportName: string) {
  return `const ${local} = (props) => globalThis.renderSolidIsland(${implLocal}, props, { moduleId: ${JSON.stringify(moduleId)}, exportName: ${JSON.stringify(exportName)} });`
}

export function buildSolidIslandReplacementFromImport(
  imp: ScannedImport,
  islandModuleId: string,
): SolidIslandReplacement {
  const source = JSON.stringify(imp.source)
  const lines: string[] = []

  if (imp.defaultBinding != null) {
    const impl = `__rariIsland_${imp.defaultBinding}`
    lines.push(`import ${impl} from ${source};`)
    lines.push(wrapperFor(imp.defaultBinding, impl, islandModuleId, 'default'))
  }

  for (const spec of imp.named) {
    if (spec.typeOnly) continue
    const impl = `__rariIsland_${spec.local}`
    lines.push(`import { ${spec.imported} as ${impl} } from ${source};`)
    lines.push(wrapperFor(spec.local, impl, islandModuleId, spec.imported))
  }

  return { code: lines.join('\n') }
}
