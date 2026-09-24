use std::time::Duration;

pub const MEMORY_PRESSURE_THRESHOLD: f64 = 0.8;
pub const MEMORY_PRESSURE_RENDER_THRESHOLD_NUM: usize = 8;
pub const MEMORY_PRESSURE_RENDER_THRESHOLD_DEN: usize = 10;
pub const CACHE_CLEANUP_INTERVAL: Duration = Duration::from_millis(10);

pub const MAX_RETRIES: u64 = 3;
pub const RETRY_BASE_DELAY_MS: u64 = 150;
pub const COMPONENT_AVAILABILITY_CHECK_DELAY_MS: u64 = 20;

pub const DEFAULT_MAX_CONCURRENT_RENDERS: usize = 50;
pub const DEFAULT_MAX_RENDER_TIME_MS: u64 = 8000;
pub const DEFAULT_MAX_SCRIPT_EXECUTION_TIME_MS: u64 = 3000;
pub const DEFAULT_MAX_MEMORY_PER_COMPONENT_MB: usize = 50;
pub const DEFAULT_MAX_CACHE_SIZE: usize = 1000;

pub const V8_CACHE_CLEAR_SCRIPT: &str = include_str!("js/v8_cache_clear.ts");

// Server action handler: seroval decode/encode over the shared resolver and arg validator.
pub const SOLID_ACTION_HANDLER_SCRIPT: &str = concat!(
    include_str!("js/action_fn_resolver.ts"),
    include_str!("js/action_args_validation.core.ts"),
    include_str!("js/action_args_validation_v8.ts"),
    include_str!("js/solid_action_handler.ts"),
);

pub const SOLID_ACTIONS_READY_CHECK: &str =
    "typeof globalThis.dispatchSolidServerAction === 'function'";

// Solid render scripts, loaded by RscRenderer::ensure_solid_pipeline (vendored Solid: see
// crates/rari/src/runtime/module_loader/solid_vendor.rs).
pub const SOLID_RSC_RENDERER_SCRIPT: &str = include_str!("js/solid_rsc_renderer.ts");
pub const SOLID_STREAMING_SCRIPT: &str = include_str!("../layout/js/solid_streaming.ts");
pub const SOLID_COMPONENT_LOADER_SCRIPT: &str = include_str!("js/solid_component_loader.ts");
pub const SOLID_PROPS_CODEC_SCRIPT: &str = include_str!("js/solid_props_codec.ts");
pub const SOLID_ISLANDS_SCRIPT: &str = include_str!("js/solid_islands.ts");
pub const SOLID_ROUTE_SCRIPT: &str = include_str!("../layout/js/solid_route.ts");

pub const SOLID_PIPELINE_READY_CHECK: &str = "typeof globalThis.renderSolidToHtml === 'function' \
        && typeof globalThis.renderToSolidRsc === 'function' \
        && typeof globalThis.registerSolidComponent === 'function' \
        && typeof globalThis.encodeSolidProps === 'function' \
        && typeof globalThis.renderSolidIsland === 'function' \
        && typeof globalThis.renderSolidRouteStreaming === 'function' \
        && typeof globalThis.resetSolidIslandState === 'function'";

pub const EXTENSION_CHECKS: &str = r"(function () {
  const checks = {};
  checks.rsc_renderer = true;
  if (!globalThis.registerModule)
    throw new Error('RSC Modules extension not loaded');
  checks.rsc_modules = true;
  return {
    initialized: true,
    extensions: checks,
    timestamp: Date.now(),
  };
})();";

pub const BATCH_ERROR_COLLECTION: &str = r"(function () {
  if (!globalThis['~errors'])
    globalThis['~errors'] = {};
  const errors = globalThis['~errors'].batch || [];
  globalThis['~errors'].batch = [];
  return {
    success: errors.length === 0,
    errors,
    timestamp: Date.now(),
  };
})();";

pub const SERVER_FUNCTION_RESOLVER: &str = r"(function () {
  if (!globalThis.ServerFunctions)
    throw new Error('ServerFunctions extension not loaded');
  return globalThis.ServerFunctions.resolve();
})();";

pub fn resolve_server_functions_for_component(component_id: &str) -> String {
    format!(
        r"(async function () {{
  try {{
    if (typeof globalThis.resolveServerFunctionsForComponent === 'function')
      await globalThis.resolveServerFunctionsForComponent('{component_id}');
    return {{ success: true, resolved: true }};
  }} catch (error) {{
    return {{ success: false, error: error.message }};
  }}
}})()"
    )
}

pub fn module_registration_script_from_import(
    module_specifier: &str,
    component_id: &str,
) -> String {
    let specifier_json =
        serde_json::to_string(module_specifier).unwrap_or_else(|_| "\"\"".to_string());
    let component_id_json =
        serde_json::to_string(component_id).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r"(async function () {{
  try {{
    const moduleNamespace = await import({specifier_json});
    if (typeof globalThis.RscModuleManager?.register === 'function') {{
      const result = globalThis.RscModuleManager.register(moduleNamespace, {component_id_json});
      return {{ success: true, module: {component_id_json}, exports: result.exportCount }};
    }} else if (typeof globalThis.registerModule === 'function') {{
      const result = globalThis.registerModule(moduleNamespace, {component_id_json});
      return {{ success: true, module: {component_id_json}, exports: result.exportCount }};
    }} else {{
      throw new Error('No module registration function available');
    }}
  }} catch (error) {{
    throw error;
  }}
}})()"
    )
}
