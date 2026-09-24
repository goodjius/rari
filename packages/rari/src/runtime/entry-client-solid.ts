/**
 * Phase-2 client entry for the React -> SolidJS migration. Mirrors
 * entry-client.ts's role (decode the server payload, hydrate) but against
 * the island row protocol from
 * crates/rari/src/rendering/base/js/solid_islands.ts, and against Solid's
 * `hydrate` instead of `hydrateRoot`.
 *
 * Standalone template only: not wired into the Vite build, the app router,
 * or any virtual module - those integrations are deferred to a later
 * phase. Also unverified by a real-V8 test in this repo's test suite: the
 * vendored `solid-js/web` build (crates/rari/src/runtime/ext/rari/solid/vendor)
 * is the *server* build (needed for renderToString/renderToStream to work
 * at all - see tools/bundle-solid-esm/bundle.ts), whose `hydrate` export is
 * a hard `notSup` stub; real hydration only exists in the client build,
 * which additionally needs a real `document` the V8/deno_core runtime
 * doesn't have. This file is exercised only by whatever real browser
 * eventually loads it.
 */
import type { Component } from 'solid-js'
import { createComponent } from 'solid-js'
import { hydrate } from 'solid-js/web'
import { isFunction, isRecord } from '../shared/utils/type-guards'
import { decodeSeroval } from './seroval-json'

export interface SolidIslandRow {
  readonly moduleId: string
  readonly exportName: string
  readonly islandId: string
  readonly renderId: string
  readonly props: string
}

function isIslandRow(value: unknown): value is SolidIslandRow {
  return (
    isRecord(value) &&
    typeof value.moduleId === 'string' &&
    typeof value.exportName === 'string' &&
    typeof value.islandId === 'string' &&
    typeof value.renderId === 'string' &&
    typeof value.props === 'string'
  )
}

export function decodeSolidIslandRow(rowText: string): SolidIslandRow {
  const row = rowText.trim()
  const separatorIndex = row.indexOf(':')
  if (!row.startsWith('I') || separatorIndex === -1)
    throw new Error(`[rari] Unrecognized Solid island row: ${row}`)

  const parsed: unknown = JSON.parse(row.slice(separatorIndex + 1))
  if (!isIslandRow(parsed)) throw new Error(`[rari] Malformed Solid island row payload: ${row}`)

  return parsed
}

function asPropsRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/**
 * Hydrates one island: re-imports its module, deserializes its props, and
 * hydrates it at its `data-rari-island` anchor, seeded with the exact same
 * `renderId` the server minted for it (see solid_islands.ts's doc comment
 * on `renderSolidIsland` for why this specific id has to match) - `hydrate`
 * seeds `sharedConfig.context` from `options.renderId`, and this call then
 * goes through `createComponent` exactly like the server side did, so both
 * produce the same `data-hk` id sequence inside the island's subtree.
 */
export async function hydrateSolidIsland(row: Readonly<SolidIslandRow>): Promise<void> {
  const container = document.querySelector(`[data-rari-island="${row.islandId}"]`)
  if (container == null)
    throw new Error(`[rari] Solid island anchor not found in DOM: ${row.islandId}`)

  // The virtual client entry (packages/rari/src/vite/index.ts) registers a
  // loader per island module so the server's `moduleId` (a build-time id, not
  // a browsable URL) resolves to a real dynamic import; fall back to importing
  // the id directly for hand-rolled setups.
  const loader = window.__RARI_SOLID_ISLAND_LOADERS__?.[row.moduleId]
  const componentModule: unknown = await (loader != null
    ? loader()
    : import(/* @vite-ignore */ row.moduleId))
  const component = isRecord(componentModule) ? componentModule[row.exportName] : undefined
  if (!isFunction(component))
    throw new Error(`[rari] Solid island export not found: ${row.moduleId}#${row.exportName}`)

  const props = asPropsRecord(row.props !== '' ? decodeSeroval(row.props) : {})

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion - component shape is dynamic (loaded by module id)
  const typedComponent = component as Component<Record<string, unknown>>
  hydrate(() => createComponent(typedComponent, props), container, {
    renderId: row.renderId,
  })
}

declare global {
  interface Window {
    __RARI_SOLID_ISLANDS__?: readonly string[]
    __RARI_SOLID_ISLAND_LOADERS__?: Readonly<Record<string, () => Promise<unknown>>>
    __rari_client_ready?: boolean
  }
}

/** Hydrates every island row already pushed (or pushed later) onto
 * `window.__RARI_SOLID_ISLANDS__` by the inline `<script>` tags
 * solid_islands.ts emits - handles both rows present before this entry
 * runs and any streamed in afterward (from a later Suspense-revealed
 * chunk), by replacing the array with a `push`-intercepting one.
 */
export function hydrateAllSolidIslands(): void {
  const existing = window.__RARI_SOLID_ISLANDS__ ?? []
  const initial = existing.map(async rowText => hydrateSolidIsland(decodeSolidIslandRow(rowText)))

  const rows: string[] = []
  const hydrateRows = (incoming: readonly string[]): number => {
    for (const rowText of incoming) void hydrateSolidIsland(decodeSolidIslandRow(rowText))
    // The instance's own `push` is replaced below, so call the real one explicitly.
    return Array.prototype.push.apply(rows, [...incoming])
  }
  window.__RARI_SOLID_ISLANDS__ = Object.assign(rows, { push: hydrateRows })
  // Flag for tooling (e2e): every island present at load has finished hydrating.
  void Promise.allSettled(initial).then(results => {
    for (const result of results) {
      if (result.status === 'rejected')
        console.error('[rari] island hydration failed:', result.reason)
    }
    window.__rari_client_ready = true
  })
}
