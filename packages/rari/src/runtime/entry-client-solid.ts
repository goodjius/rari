/**
 * First-slice PoC client entry for the React -> SolidJS migration.
 * Mirrors entry-client.ts's role (decode the server payload, hydrate the
 * root) but against the minimal row protocol from
 * crates/rari/src/rendering/base/js/solid_rsc_renderer.ts, and against
 * Solid's `hydrate` instead of `hydrateRoot`.
 *
 * Standalone template only: not wired into the Vite build, the app router,
 * or any virtual module - those integrations are deferred to a later phase
 * once this slice validates the core server/client pipeline. See the Solid
 * PoC plan for scope.
 */
import { hydrate } from 'solid-js/web'

interface SolidComponentReferenceRow {
  readonly moduleId: string
  readonly exportName: string
}

export function decodeSolidRscPayload(payload: string): SolidComponentReferenceRow {
  const row = payload.trim()
  const separatorIndex = row.indexOf(':')
  if (!row.startsWith('I') || separatorIndex === -1)
    throw new Error(`[rari] Unrecognized Solid RSC row: ${row}`)

  const parsed: unknown = JSON.parse(row.slice(separatorIndex + 1))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).moduleId !== 'string' ||
    typeof (parsed as Record<string, unknown>).exportName !== 'string'
  )
    throw new Error(`[rari] Malformed Solid RSC row payload: ${row}`)

  return parsed as unknown as SolidComponentReferenceRow
}

export async function hydrateSolidRoot(container: Element, payload: string): Promise<void> {
  const { moduleId, exportName } = decodeSolidRscPayload(payload)
  // oxlint-disable-next-line typescript/no-unsafe-assignment - dynamic module id from the server payload
  const componentModule = (await import(/* @vite-ignore */ moduleId)) as Record<string, unknown>
  const component = componentModule[exportName]
  if (typeof component !== 'function')
    throw new Error(`[rari] Solid component export not found: ${moduleId}#${exportName}`)

  hydrate(() => (component as () => unknown)(), container)
}
