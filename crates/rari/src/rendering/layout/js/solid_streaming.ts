/* oxlint-disable typescript/no-unsafe-type-assertion, typescript/prefer-readonly-parameter-types, typescript/non-nullable-type-assertion-style -- Rust-embedded script: bare `import()` of vendored Solid modules and `g` globals are untyped at this boundary */
/// <reference path="../../types.d.ts" />

/**
 * Blocking (non-streaming) SSR output for a single Solid component. Uses
 * `await import(...)` rather than a static `import` because this file runs
 * as a script via `execute_script`, not as an ES module. Streaming +
 * Suspense support lives in `renderSolidToHtmlStreaming` below.
 *
 * Reuses react/component_loader.ts's `registerComponent` to load the
 * component onto `g[componentId]` - that loader is generic (it only checks
 * `typeof === 'function'`), so it works unchanged for a Solid component.
 *
 * `propsExpr`, when given, is a seroval-serialized expression string (see
 * solid_props_codec.ts) - deserialized here via `seroval.fromJSON`
 * rather than spliced as literal script text, so untrusted prop *values*
 * never need to be safely embedded as executable code on this path (the
 * hydration-payload embed in solid_islands.ts is the one place a seroval
 * string does get embedded as script text, since the browser has to read it
 * back without an RPC call).
 */
async function renderSolidToHtml(componentId: string, propsExpr?: string): Promise<string> {
  const solidWeb = (await import('solid-js/web')) as {
    renderToString: (fn: () => unknown) => string
  }
  const { createComponent } = (await import('solid-js')) as {
    createComponent: (comp: (props: unknown) => unknown, props: unknown) => unknown
  }
  const { fromJSON } = (await import('seroval')) as {
    fromJSON: (value: unknown) => unknown
  }

  const component = (g as Record<string, unknown>)[componentId]
  if (typeof component !== 'function')
    throw new Error(`[rari] Solid component not loaded: ${componentId}`)

  const props = propsExpr != null && propsExpr !== '' ? fromJSON(JSON.parse(propsExpr)) : {}

  return solidWeb.renderToString(() => createComponent(component as (p: unknown) => unknown, props))
}

g.renderSolidToHtml = renderSolidToHtml

interface SolidStreamWritable {
  write: (text: string) => void
  end: () => void
}

interface RenderToStreamResult {
  pipe: (writable: SolidStreamWritable) => void
}

/** Optional per-chunk rewriting between Solid's stream and the byte ops (see solid_route.ts). */
interface SolidStreamTransform {
  write: (text: string) => string
  end: () => string
}

/**
 * Adapts `solid-js/web`'s `renderToStream(...).pipe({write, end})` callback
 * interface onto the generic `op_stream_chunk*` ops
 * (`crates/rari/src/runtime/ops.rs`: raw byte passthrough, zero HTML
 * assumptions, no changes needed).
 *
 * `write` is called synchronously by Solid, but `op_stream_chunk`'s
 * backpressure fallback is async - so this can't just forward each write
 * directly to an op call. Instead it's a local queue drained by an async
 * pump, with explicit completion tracking via `end()` (which `renderToStream`
 * calls itself exactly once, after every tracked Suspense resource has
 * settled - not just after the initial shell).
 *
 * Top-level function declaration (a global in this script context) so
 * solid_route.ts can reuse it.
 */
async function rariSolidPipeToOps(
  streamId: string,
  produce: (writable: SolidStreamWritable) => void,
  transform?: SolidStreamTransform,
): Promise<void> {
  const queue: string[] = []
  let pumping = false
  let ended = false

  await new Promise<void>((resolve, reject) => {
    async function pump(): Promise<void> {
      if (!pumping) {
        pumping = true
        try {
          while (queue.length > 0) {
            const chunk = queue.shift() as string
            const status = Deno.core.ops.op_stream_chunk_try(streamId, chunk)
            if (status === 0) continue // sent
            if (status === 2) {
              // receiver disconnected - drop the rest, nothing more to send
              queue.length = 0
              break
            }
            // status === 1: channel full, fall back to the async/backpressure op
            await Deno.core.ops.op_stream_chunk(streamId, chunk)
          }
        } finally {
          pumping = false
        }
      }
      // Re-checked after every pump attempt (including ones that found
      // another pump already in flight and skipped the loop above) so
      // whichever call is the last to actually finish the drain is the one
      // that finalizes - never missed, never double-fired incorrectly.
      if (ended && queue.length === 0 && !pumping) {
        Deno.core.ops.op_stream_done(streamId)
        resolve()
      }
    }

    const writable: SolidStreamWritable = {
      write(text: string) {
        const out = transform != null ? transform.write(text) : text
        if (out) queue.push(out)
        void pump()
      },
      end() {
        const tail = transform != null ? transform.end() : ''
        if (tail) queue.push(tail)
        ended = true
        void pump()
      },
    }

    try {
      produce(writable)
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/** Streaming SSR of a single registered component with native Suspense reveal. */
async function renderSolidToHtmlStreaming(
  componentId: string,
  streamId: string,
  propsExpr?: string,
): Promise<void> {
  const solidWeb = (await import('solid-js/web')) as {
    renderToStream: (fn: () => unknown) => RenderToStreamResult
  }
  const { createComponent } = (await import('solid-js')) as {
    createComponent: (comp: (props: unknown) => unknown, props: unknown) => unknown
  }
  const { fromJSON } = (await import('seroval')) as {
    fromJSON: (value: unknown) => unknown
  }

  const component = (g as Record<string, unknown>)[componentId]
  if (typeof component !== 'function')
    throw new Error(`[rari] Solid component not loaded: ${componentId}`)

  const props = propsExpr != null && propsExpr !== '' ? fromJSON(JSON.parse(propsExpr)) : {}

  await rariSolidPipeToOps(streamId, writable => {
    solidWeb
      .renderToStream(() => createComponent(component as (p: unknown) => unknown, props))
      .pipe(writable)
  })
}

g.renderSolidToHtmlStreaming = renderSolidToHtmlStreaming
