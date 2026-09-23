/// <reference path="../../types.d.ts" />

/**
 * Solid's analog to a React "client reference": Solid has no code-
 * elimination-via-serialization mechanism (every component is just a
 * function - there's no RSC-style "this code never reaches the client"
 * concept to hook into), so this is an *islands* design instead. A
 * directive-marked component gets its own client bundle entry point
 * (reusing the same 'use client' directive scan that already builds
 * packages/rari/src/vite/server/build.ts's client-reference manifest - the
 * exclusion happens via the build graph, same as React, just without a
 * runtime marker object Solid has no consumer for) and is hydrated
 * independently via its own `hydrate()` root.
 */

interface SolidHydrateContext {
  readonly id: string
  readonly count: number
  readonly noHydrate?: boolean
}

interface SolidSharedConfig {
  context: SolidHydrateContext | undefined
  getNextContextId: () => string
}

interface SolidCoreModule {
  sharedConfig: SolidSharedConfig
  createComponent: (comp: (props: unknown) => unknown, props: unknown) => unknown
}

interface SolidWebModule {
  ssrElement: (tag: string, props: unknown, children: unknown, needsId: boolean) => unknown
}

interface SerovalModule {
  serialize: (value: unknown) => string
}

interface RariSolidIslandState {
  core: SolidCoreModule
  web: SolidWebModule
  seroval: SerovalModule
  islandCounter: number
  rowCounter: number
}

/**
 * Eagerly resolves solid-js/solid-js-web/seroval once during pipeline init
 * (see RscRenderer::ensure_solid_pipeline_uncached) and stashes them on a
 * global. `renderSolidIsland` runs synchronously, during Solid's own
 * synchronous tree walk (it's called from inside a component's render, the
 * same place `ssrElement` calls happen) - it cannot `await` a dynamic
 * import mid-render, so those modules must already be resolved by the time
 * any render starts.
 */
async function initSolidIslands(): Promise<void> {
  const core = (await import('solid-js')) as unknown as SolidCoreModule
  const web = (await import('solid-js/web')) as unknown as SolidWebModule
  const seroval = (await import('seroval')) as unknown as SerovalModule
  g['~rariSolidIslands'] = { core, web, seroval, islandCounter: 0, rowCounter: 0 }
}

function islandState(): RariSolidIslandState {
  const state = g['~rariSolidIslands'] as RariSolidIslandState | undefined
  if (state == null) throw new Error('[rari] Solid islands not initialized - call initSolidIslands first')
  return state
}

/**
 * Resets per-render island bookkeeping (the island/row counters). Must be
 * called once at the start of every render that might contain islands -
 * this pipeline assumes one render in flight per isolate at a time (the
 * same assumption Solid's own `sharedConfig.context` already makes; a
 * shared ambient counter isn't a new constraint this introduces).
 */
function resetSolidIslandState(): void {
  const state = islandState()
  state.islandCounter = 0
  state.rowCounter = 0
}

interface SolidIslandMeta {
  readonly moduleId: string
  readonly exportName: string
}

interface SolidIslandRow {
  readonly moduleId: string
  readonly exportName: string
  readonly islandId: string
  readonly renderId: string
  readonly props: string
}

function encodeSolidIslandRowScript(rowIndex: number, row: SolidIslandRow): string {
  const rowText = `I${rowIndex.toString(16)}:${JSON.stringify(row)}\n`
  return `<script>(window.__RARI_SOLID_ISLANDS__ ??= []).push(${JSON.stringify(rowText)})</script>`
}

/**
 * Renders a directive-marked component as an independently hydratable
 * island: wraps its SSR output in a `data-rari-island` anchor and returns
 * an inline row (an executable `<script>` pushing onto
 * `window.__RARI_SOLID_ISLANDS__`) identifying which module/export/props
 * the client should hydrate against, immediately following the island's own
 * HTML - works uniformly whether the island is in the shell or a later
 * Suspense-revealed streaming chunk, no cross-stream buffering needed.
 *
 * Mints its own child hydration-context id (`renderId`) via solid-js's
 * `sharedConfig`/`getNextContextId` - `sharedConfig` is a live, mutable,
 * exported object, so assigning `sharedConfig.context` directly has the
 * same effect as solid-js's internal (unexported) `setHydrateContext`
 * helper (verified by reading solid-js@1.9.15's source, not just inferred).
 * This makes the client's later `hydrate(fn, el, { renderId })` call
 * reproduce the identical id sequence `createComponent` used server-side
 * inside this subtree. `renderToStream` always establishes a root
 * hydrating context before rendering (confirmed via source read), so
 * `sharedConfig.context` is truthy for any island encountered during a
 * real render; the `else` branch below only matters for a render with no
 * active hydrating context at all (e.g. a hydration-free static render).
 */
function renderSolidIsland(
  component: (props: unknown) => unknown,
  props: unknown,
  meta: SolidIslandMeta,
): unknown {
  const state = islandState()
  const { core, web, seroval } = state

  const islandId = `island-${state.islandCounter}`
  state.islandCounter += 1

  const parent = core.sharedConfig.context
  let renderId = ''
  let body: unknown

  if (parent != null && !parent.noHydrate) {
    const child: SolidHydrateContext = { ...parent, id: core.sharedConfig.getNextContextId(), count: 0 }
    core.sharedConfig.context = child
    renderId = child.id
    try {
      body = core.createComponent(component, props)
    } finally {
      core.sharedConfig.context = parent
    }
  } else {
    body = core.createComponent(component, props)
  }

  const wrapper = web.ssrElement('div', { 'data-rari-island': islandId }, body, false)

  const rowIndex = state.rowCounter
  state.rowCounter += 1
  const row: SolidIslandRow = {
    moduleId: meta.moduleId,
    exportName: meta.exportName,
    islandId,
    renderId,
    props: seroval.serialize(props),
  }

  return [wrapper, encodeSolidIslandRowScript(rowIndex, row)]
}

g.initSolidIslands = initSolidIslands
g.resetSolidIslandState = resetSolidIslandState
g.renderSolidIsland = renderSolidIsland
