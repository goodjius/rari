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
import { deserialize } from 'seroval'

interface SolidIslandRow {
  readonly moduleId: string
  readonly exportName: string
  readonly islandId: string
  readonly renderId: string
  readonly props: string
}

export function decodeSolidIslandRow(rowText: string): SolidIslandRow {
  const row = rowText.trim()
  const separatorIndex = row.indexOf(':')
  if (!row.startsWith('I') || separatorIndex === -1)
    throw new Error(`[rari] Unrecognized Solid island row: ${row}`)

  const parsed: unknown = JSON.parse(row.slice(separatorIndex + 1))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).moduleId !== 'string' ||
    typeof (parsed as Record<string, unknown>).exportName !== 'string' ||
    typeof (parsed as Record<string, unknown>).islandId !== 'string' ||
    typeof (parsed as Record<string, unknown>).renderId !== 'string' ||
    typeof (parsed as Record<string, unknown>).props !== 'string'
  )
    throw new Error(`[rari] Malformed Solid island row payload: ${row}`)

  return parsed as unknown as SolidIslandRow
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
export async function hydrateSolidIsland(row: SolidIslandRow): Promise<void> {
  const container = document.querySelector(`[data-rari-island="${row.islandId}"]`)
  if (container == null)
    throw new Error(`[rari] Solid island anchor not found in DOM: ${row.islandId}`)

  // oxlint-disable-next-line typescript/no-unsafe-assignment - dynamic module id from the server payload
  const componentModule = (await import(/* @vite-ignore */ row.moduleId)) as Record<string, unknown>
  const component = componentModule[row.exportName]
  if (typeof component !== 'function')
    throw new Error(`[rari] Solid island export not found: ${row.moduleId}#${row.exportName}`)

  const props = row.props !== '' ? deserialize(row.props) : {}

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion - component/props shapes are dynamic (loaded by module id)
  const typedComponent = component as Component<Record<string, unknown>>
  hydrate(() => createComponent(typedComponent, props as Record<string, unknown>), container, {
    renderId: row.renderId,
  })
}

declare global {
  interface Window {
    __RARI_SOLID_ISLANDS__?: readonly string[]
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
  for (const rowText of existing) void hydrateSolidIsland(decodeSolidIslandRow(rowText))

  const pending: string[] = []
  window.__RARI_SOLID_ISLANDS__ = new Proxy(pending, {
    get(target, prop, receiver) {
      if (prop === 'push') {
        return (...rows: string[]) => {
          for (const rowText of rows) void hydrateSolidIsland(decodeSolidIslandRow(rowText))
          return Reflect.get(target, prop, receiver).apply(target, rows)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as unknown as string[]
}
