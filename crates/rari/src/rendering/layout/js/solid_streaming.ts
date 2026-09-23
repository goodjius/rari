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
 * solid_props_codec.ts) - deserialized here via `seroval.deserialize`
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
  const { deserialize } = (await import('seroval')) as {
    deserialize: (value: string) => unknown
  }

  const component = (g as Record<string, unknown>)[componentId]
  if (typeof component !== 'function')
    throw new Error(`[rari] Solid component not loaded: ${componentId}`)

  const props = propsExpr != null && propsExpr !== '' ? deserialize(propsExpr) : {}

  return solidWeb.renderToString(() =>
    createComponent(component as (p: unknown) => unknown, props),
  )
}

g.renderSolidToHtml = renderSolidToHtml

interface SolidStreamWritable {
  write: (text: string) => void
  end: () => void
}

interface RenderToStreamResult {
  pipe: (writable: SolidStreamWritable) => void
}

/**
 * Streaming SSR with native Suspense boundary reveal, via `solid-js/web`'s
 * `renderToStream`. Solid already does the hard part here (fallback-first,
 * `<template>`-swap reveal, resource-data serialization for hydration -
 * see the phase-2 plan) - this function's only job is adapting its
 * `pipe({write, end})` callback interface onto the existing generic
 * `op_fizz_chunk*` ops (`crates/rari/src/runtime/ops.rs`), which are raw
 * byte passthrough with zero HTML assumptions and need no changes.
 *
 * `write` is called synchronously by Solid, but `op_fizz_chunk`'s
 * backpressure fallback is async - so this can't just forward each write
 * directly to an op call. Instead it's a local queue drained by an async
 * pump, with explicit completion tracking via `end()` (which `renderToStream`
 * calls itself exactly once, after every tracked Suspense resource has
 * settled - not just after the initial shell).
 */
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
  const { deserialize } = (await import('seroval')) as {
    deserialize: (value: string) => unknown
  }

  const component = (g as Record<string, unknown>)[componentId]
  if (typeof component !== 'function')
    throw new Error(`[rari] Solid component not loaded: ${componentId}`)

  const props = propsExpr != null && propsExpr !== '' ? deserialize(propsExpr) : {}

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
            const status = Deno.core.ops.op_fizz_chunk_try(streamId, chunk)
            if (status === 0) continue // sent
            if (status === 2) {
              // receiver disconnected - drop the rest, nothing more to send
              queue.length = 0
              break
            }
            // status === 1: channel full, fall back to the async/backpressure op
            await Deno.core.ops.op_fizz_chunk(streamId, chunk)
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
        Deno.core.ops.op_fizz_done(streamId)
        resolve()
      }
    }

    const writable: SolidStreamWritable = {
      write(text: string) {
        if (text) queue.push(text)
        void pump()
      },
      end() {
        ended = true
        void pump()
      },
    }

    try {
      solidWeb.renderToStream(() => createComponent(component as (p: unknown) => unknown, props)).pipe(writable)
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

g.renderSolidToHtmlStreaming = renderSolidToHtmlStreaming
