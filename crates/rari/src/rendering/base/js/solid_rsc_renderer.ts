/// <reference path="../../types.d.ts" />

/**
 * First-slice PoC of a Solid analogue to React Flight's row protocol.
 * SolidJS has no serializable element tree the way React does (components
 * run immediately against real reactive DOM, there's nothing to walk before
 * execution), so this cannot mirror Flight's tree-serialization directly.
 * Instead it captures the smallest useful equivalent: a single "reference"
 * row telling the client which module + export to import and hydrate
 * against - conceptually the same job as one of Flight's import rows, with
 * everything else (props, client components, Suspense/streaming boundaries)
 * deliberately out of scope for this slice.
 */
interface SolidComponentReferenceRow {
  readonly moduleId: string
  readonly exportName: string
}

function encodeSolidComponentReferenceRow(row: SolidComponentReferenceRow): string {
  return `I0:${JSON.stringify(row)}\n`
}

async function renderToSolidRsc(moduleId: string, exportName = 'default'): Promise<string> {
  return encodeSolidComponentReferenceRow({ moduleId, exportName })
}

g.renderToSolidRsc = renderToSolidRsc
