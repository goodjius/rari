/// <reference path="../../types.d.ts" />

/**
 * Wire-encodes props for Solid components via `seroval` (already a real
 * dependency - `solid-js/web`'s own server build uses it for resource
 * hydration data, see solid_islands.ts). Unlike React's approach here
 * (`serde_json::to_string` spliced directly as a JS object literal, in
 * `crates/rari/src/rendering/layout/core.rs`), a seroval expression string
 * supports `Date`/`Map`/`Set`/`undefined`/`NaN`/cyclic references, and
 * throws on genuinely unsupported values (functions, Symbols) instead of
 * silently dropping them.
 *
 * The returned string is a JS *expression*, not JSON text - it gets spliced
 * directly into a render script (`const props = <expr>;`), not JSON.parse'd.
 */
async function encodeSolidProps(props: unknown): Promise<string> {
  const { serialize } = (await import('seroval')) as { serialize: (value: unknown) => string }
  return serialize(props)
}

g.encodeSolidProps = encodeSolidProps
