/// <reference path="../../types.d.ts" />

/**
 * First-slice PoC SSR output for a single Solid component, replacing Fizz
 * (streaming_fizz.ts) for the one fixture route this slice targets. No
 * streaming and no Suspense - just enough to prove the vendored
 * `solid-js/web` build runs inside V8 and produces real HTML. Uses
 * `await import(...)` rather than a static `import` because this file runs
 * as a script via `execute_script`, not as an ES module.
 *
 * Reuses react/component_loader.ts's `registerComponent` to load the
 * component onto `g[componentId]` - that loader is generic (it only checks
 * `typeof === 'function'`), so it works unchanged for a Solid component.
 */
async function renderSolidToHtml(componentId: string): Promise<string> {
  const solidWeb = (await import('solid-js/web')) as {
    renderToString: (fn: () => unknown) => string
  }

  const component = (g as Record<string, unknown>)[componentId]
  if (typeof component !== 'function')
    throw new Error(`[rari] Solid component not loaded: ${componentId}`)

  return solidWeb.renderToString(() => (component as () => unknown)())
}

g.renderSolidToHtml = renderSolidToHtml
