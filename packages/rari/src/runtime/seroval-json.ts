import type { SerovalJSON } from 'seroval'
import { fromJSON, toJSON } from 'seroval'

// JSON mode (not `serialize`/`deserialize`): those evaluate generated code, which the default
// CSP (no 'unsafe-eval') blocks in the browser.
export function encodeSeroval(value: unknown): string {
  return JSON.stringify(toJSON(value))
}

export function decodeSeroval(text: string): unknown {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- produced by encodeSeroval on the other side
  return fromJSON(JSON.parse(text) as SerovalJSON)
}
