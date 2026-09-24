pub mod cache;

use deno_core::{Extension, ExtensionArguments, extension};

use super::{ExtensionTrait, lazy};

extension!(
    rari,
    deps = [init_utilities, init_web],
    esm_entry_point = "ext:rari/core/rari.ts",
    esm = [
        dir "src/runtime/ext/rari",
        "core/rari.ts",
        "http/api_handler.ts",
        "component/component_loader.ts",
        "http/cookies.ts",
        "http/headers.ts",
        "cache/use_cache.ts",
        "component/metadata_collector.ts",
        "rsc/rsc_modules.ts",
        "rsc/server_functions.ts"
    ],
    lazy_loaded_esm = [
        dir "src/runtime/ext/rari",
        // Vendored Solid - see crates/rari/src/runtime/module_loader/solid_vendor.rs.
        "solid/vendor/solid-js.js",
        "solid/vendor/solid-js-web.js",
        "solid/vendor/solid-js-h.js",
        "solid/vendor/seroval.js",
    ],
);

impl ExtensionTrait<()> for rari {
    fn init((): ()) -> Extension {
        Self::init()
    }
}

pub fn extensions(is_snapshot: bool) -> (Vec<Extension>, Vec<ExtensionArguments>) {
    let mut extensions = Vec::new();
    let mut lazy_args = Vec::new();
    lazy::register::<(), rari>((), is_snapshot, &mut extensions, &mut lazy_args);
    (extensions, lazy_args)
}
