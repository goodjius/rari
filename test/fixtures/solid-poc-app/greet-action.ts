// Server action fixture for the Solid migration's server-actions phase.
// Deliberately plain: dispatch_solid_server_action reuses
// action_fn_resolver.ts's resolveActionFn unchanged, which resolves a bare
// named export - no registerServerReference-style registration wrapper is
// needed for this to work.

export async function greet(name: string): Promise<string> {
  return `Hello, ${name}!`
}
