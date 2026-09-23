import { beforeEach, describe, expect, it } from 'vitest'
import { decodeSolidRscPayload } from '@rari/runtime/entry-client-solid'

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
  await import(
    '../../../crates/rari/src/rendering/base/js/solid_rsc_renderer.ts'
  )
})

describe('renderToSolidRsc', () => {
  it('encodes a single import-reference row identifying the component to hydrate', async () => {
    const payload = await renderToSolidRsc('/solid-poc-app/component.ts', 'default')

    expect(payload).toBe('I0:{"moduleId":"/solid-poc-app/component.ts","exportName":"default"}\n')
  })

  it('defaults the export name to "default"', async () => {
    const payload = await renderToSolidRsc('/solid-poc-app/component.ts')

    const decoded = decodeSolidRscPayload(payload)
    expect(decoded).toEqual({ moduleId: '/solid-poc-app/component.ts', exportName: 'default' })
  })

  it('round-trips through the client-side decoder', async () => {
    const payload = await renderToSolidRsc('/fixtures/other.ts', 'NamedExport')

    expect(decodeSolidRscPayload(payload)).toEqual({
      moduleId: '/fixtures/other.ts',
      exportName: 'NamedExport',
    })
  })
})

describe('decodeSolidRscPayload', () => {
  it('rejects rows that are not an import-reference row', () => {
    expect(() => decodeSolidRscPayload('X0:{}')).toThrow('Unrecognized Solid RSC row')
  })

  it('rejects malformed row payloads', () => {
    expect(() => decodeSolidRscPayload('I0:{"moduleId":"x"}')).toThrow(
      'Malformed Solid RSC row payload',
    )
  })
})
