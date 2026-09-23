import { decodeSolidIslandRow } from '@rari/runtime/entry-client-solid'
import { beforeEach, describe, expect, it } from 'vite-plus/test'

// solid_rsc_renderer.ts is a Rust-embedded script (executed via
// JsRuntimeInterface::execute_script inside V8, not bundled by Vite), so it
// reads/writes the `g` global directly instead of using module imports/exports.
// test/setup.ts already stubs `g` as `globalThis` for every test (matching
// the real runtime - see crates/rari/src/runtime/ext/types.d.ts), so this
// file runs unmodified under Vitest once imported.
declare global {
  function renderToSolidRsc(moduleId: string, exportName?: string): Promise<string>
}

beforeEach(async () => {
  // @ts-expect-error - Rust-embedded script: no exports, and a .ts import path
  await import('../../../crates/rari/src/rendering/base/js/solid_rsc_renderer.ts')
})

// renderToSolidRsc's single-row format (no props, no islands) is a
// deliberately narrower protocol than the multi-row island format
// solid_islands.ts's renderSolidIsland produces (see decodeSolidIslandRow
// below) - it's kept for the "one static component, no client boundary"
// case the phase-1 PoC still exercises
// (crates/rari/src/rendering/base/renderer.rs's
// renders_the_solid_poc_fixture_component_through_real_v8), not because
// the two are meant to be interchangeable.
describe('renderToSolidRsc', () => {
  it('encodes a single import-reference row identifying the component to hydrate', async () => {
    const payload = await renderToSolidRsc('/solid-poc-app/component.ts', 'default')

    expect(payload).toBe('I0:{"moduleId":"/solid-poc-app/component.ts","exportName":"default"}\n')
  })

  it('defaults the export name to "default"', async () => {
    const payload = await renderToSolidRsc('/solid-poc-app/component.ts')

    expect(payload).toBe('I0:{"moduleId":"/solid-poc-app/component.ts","exportName":"default"}\n')
  })
})

// decodeSolidIslandRow decodes solid_islands.ts's row format (one row per
// island instance: moduleId/exportName/islandId/renderId/props), verified
// end-to-end against real Solid output in
// crates/rari/src/rendering/base/renderer.rs's
// renders_a_page_with_a_nested_solid_island. These tests cover the
// decoder's own parsing/validation in isolation.
describe('decodeSolidIslandRow', () => {
  it('decodes a well-formed island row', () => {
    const row =
      'I0:{"moduleId":"/fixtures/counter.ts","exportName":"default","islandId":"island-0","renderId":"0","props":"{}"}\n'

    expect(decodeSolidIslandRow(row)).toEqual({
      moduleId: '/fixtures/counter.ts',
      exportName: 'default',
      islandId: 'island-0',
      renderId: '0',
      props: '{}',
    })
  })

  it('rejects rows that are not an island row', () => {
    expect(() => decodeSolidIslandRow('X0:{}')).toThrow('Unrecognized Solid island row')
  })

  it('rejects malformed row payloads missing required fields', () => {
    expect(() => decodeSolidIslandRow('I0:{"moduleId":"x","exportName":"default"}')).toThrow(
      'Malformed Solid island row payload',
    )
  })
})
