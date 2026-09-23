/// <reference path="../../types.d.ts" />

/**
 * First-slice PoC component loader for Solid, mirroring the essential part
 * of react/component_loader.ts's registerComponent (dynamic import, bind
 * the default export onto `g[componentId]`) without that loader's React RSC
 * registry bookkeeping (exportOwners, dependency tracking), which this slice
 * doesn't need - it registers exactly one fixture component per render.
 */
async function registerSolidComponent(
  moduleSpecifier: string,
  componentId: string,
): Promise<boolean> {
  const moduleNamespace = (await import(moduleSpecifier)) as Record<string, unknown>
  const component = moduleNamespace.default
  if (typeof component !== 'function') return false

  ;(g as Record<string, unknown>)[componentId] = component
  return true
}

g.registerSolidComponent = registerSolidComponent
