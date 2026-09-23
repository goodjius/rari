/* oxlint-disable typescript/no-unsafe-type-assertion, typescript/prefer-readonly-parameter-types, typescript/non-nullable-type-assertion-style -- Rust-embedded script: bare `import()` of vendored Solid modules and `g` globals are untyped at this boundary */
/// <reference path="../../types.d.ts" />

/**
 * Solid analog of action_handler.ts's reply-mode branch. Reuses
 * action_fn_resolver.ts's `resolveActionFn` (plain module-import + named-
 * export resolution - confirmed framework-agnostic, no dependency on
 * `registerServerReference`) and action_args_validation.core.ts/_v8.ts's
 * `validateActionArgs` (generic value-shape validator) completely
 * unchanged - see constants.rs's SOLID_ACTION_HANDLER_SCRIPT, which
 * `include_str!`s the same files ACTION_HANDLER_SCRIPT does. Only the
 * Flight-specific decode/encode (decodeAction/decodeReply,
 * action_flight_shared.ts) needed a Solid analog - this file is it, using
 * seroval instead.
 *
 * Covers only the JSON-body "reply" mode (seroval-encoded args) - React's
 * `mode === 'form'`/`'reply-multipart'` FormData-based progressive-
 * enhancement paths have no analog here, a known and flagged gap (see the
 * phase-2 plan's open questions), not silently dropped.
 */
interface SolidActionOutcome {
  /** seroval expression of the envelope `{ v: result }`. */
  readonly body: string
  /** `result.redirect` (string or `{ destination }`), validated on the Rust side. */
  readonly redirect: string | null
}

async function dispatchSolidServerAction(
  actionId: string,
  argsExpr: string,
): Promise<SolidActionOutcome> {
  const { serialize, deserialize } = (await import('seroval')) as {
    serialize: (value: unknown) => string
    deserialize: (value: string) => unknown
  }

  const decoded = argsExpr !== '' ? deserialize(argsExpr) : []
  const args = Array.isArray(decoded) ? decoded : [decoded]
  const sanitizedArgs = validateActionArgs(args)

  const actionFn = resolveActionFn(actionId, {})
  const result = await actionFn(...sanitizedArgs)

  let redirect: string | null = null
  if (result != null && typeof result === 'object' && 'redirect' in result) {
    const target = result.redirect
    if (typeof target === 'string') redirect = target
    else if (target != null && typeof target === 'object' && 'destination' in target) {
      const destination = target.destination
      if (typeof destination === 'string') redirect = destination
    }
  }

  return { body: serialize({ v: result }), redirect }
}

g.dispatchSolidServerAction = dispatchSolidServerAction
