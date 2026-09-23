//! Solid vendor entrypoints for app `file://` modules.
//!
//! Mirrors `react_vendor.rs`'s strategy: full vendors live as
//! `ext:rari/solid/vendor/*` (`lazy_loaded_esm`), and deno_core 0.408+
//! rejects `file://` -> `ext:` imports after resolution, so bare
//! `solid-js` / `solid-js/web` / `solid-js/h` resolve to
//! `node:rari/solid-vendor/*` shims that re-export the real ext modules
//! (`node:` may import `ext:`).
//!
//! Scope note: this is the first-slice PoC vendor set (core reactivity,
//! the web renderer, and the hyperscript helper used to author components
//! without a JSX compiler). It does not cover `solid-js/store` or any
//! router/meta packages.

const VENDOR_MODULES: &[&str] = &["solid-js.js", "solid-js-web.js", "solid-js-h.js"];

pub const NODE_VENDOR_PREFIX: &str = "node:rari/solid-vendor/";

pub fn normalize_vendor_module_name(raw: &str) -> Option<String> {
    let name = raw.trim_end_matches(".mjs");
    let name = if name.ends_with(".js") { name.to_string() } else { format!("{name}.js") };
    VENDOR_MODULES.contains(&name.as_str()).then_some(name)
}

pub fn node_vendor_specifier(module_name: &str) -> String {
    format!("{NODE_VENDOR_PREFIX}{module_name}")
}

pub fn reexport_shim_source(module_name: &str) -> Option<String> {
    let module_name = normalize_vendor_module_name(module_name)?;
    let ext = format!("ext:rari/solid/vendor/{module_name}");
    Some(format!("export * from \"{ext}\";\nexport {{ default }} from \"{ext}\";\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_bare_names_to_canonical_js_filenames() {
        assert_eq!(normalize_vendor_module_name("solid-js"), Some("solid-js.js".to_string()));
        assert_eq!(normalize_vendor_module_name("solid-js-web"), Some("solid-js-web.js".to_string()));
        assert_eq!(normalize_vendor_module_name("solid-js-h"), Some("solid-js-h.js".to_string()));
    }

    #[test]
    fn normalizes_mjs_extension_to_js() {
        assert_eq!(normalize_vendor_module_name("solid-js-web.mjs"), Some("solid-js-web.js".to_string()));
    }

    #[test]
    fn rejects_unknown_module_names() {
        assert_eq!(normalize_vendor_module_name("solid-js-store"), None);
        assert_eq!(normalize_vendor_module_name("react"), None);
    }

    #[test]
    fn node_vendor_specifier_uses_the_solid_prefix() {
        assert_eq!(
            node_vendor_specifier("solid-js-web.js"),
            "node:rari/solid-vendor/solid-js-web.js"
        );
    }

    #[test]
    fn reexport_shim_source_targets_the_ext_solid_vendor_path() {
        let source = reexport_shim_source("solid-js-web").unwrap();
        assert!(source.contains("ext:rari/solid/vendor/solid-js-web.js"));
        assert!(source.starts_with("export * from"));
    }

    #[test]
    fn reexport_shim_source_is_none_for_unknown_modules() {
        assert_eq!(reexport_shim_source("solid-js-store"), None);
    }
}
