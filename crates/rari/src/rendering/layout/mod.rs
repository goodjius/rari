mod core;
pub mod types;
mod utils;

pub use core::{LayoutHtmlCache, LayoutRenderer};

pub use types::*;
pub use utils::create_layout_context;
pub(crate) use utils::{component_dist_path, create_component_id, drain_chunked_stream};

#[cfg(test)]
#[expect(clippy::unwrap_used)]
mod tests {
    use std::path::Path;

    use rustc_hash::FxHashMap;

    use super::*;
    use crate::server::routing::{
        app_router::{AppRouteEntry, AppRouteMatch},
        types::ParamValue,
    };

    #[test]
    fn test_component_dist_path_uses_hashed_id_from_file_path() {
        let base = Path::new("/dist/server");
        let path = utils::component_dist_path(base, "blog/_slug_/page.tsx");
        assert_eq!(
            path,
            base.join(format!("{}.js", utils::create_component_id("blog/_slug_/page.tsx")))
        );
    }

    #[test]
    fn test_create_component_id_includes_stable_hash_suffix() {
        assert_eq!(utils::create_component_id("page.tsx"), "app/page_73d7a23e");
        assert_eq!(utils::create_component_id("css/page.tsx"), "app/css/page_1a52d086");

        let at_path = utils::create_component_id("foo@bar/page.tsx");
        let hash_path = utils::create_component_id("foo#bar/page.tsx");

        assert_eq!(at_path, "app/foo_bar/page_e35d0d78");
        assert_eq!(hash_path, "app/foo_bar/page_9744e5ac");
        assert_ne!(at_path, hash_path);
    }

    #[test]
    fn test_create_page_props() {
        let mut params = FxHashMap::default();
        params.insert("id".to_string(), ParamValue::Single("123".to_string()));

        let mut search_params = FxHashMap::default();
        search_params.insert("q".to_string(), vec!["test".to_string()]);

        let context = LayoutRenderContext {
            params: params.clone(),
            search_params: search_params.clone(),
            headers: FxHashMap::default(),
            pathname: "/test".to_string(),
            template_navigation_id: None,
            metadata: None,
        };

        let route_match = AppRouteMatch {
            route: AppRouteEntry {
                path: "/test".to_string(),
                file_path: "app/test/page.tsx".to_string(),
                component_id: None,
                css: vec![],
                segments: vec![],
                params: vec![],
                is_dynamic: false,
                static_params: None,
            },
            params,
            layouts: vec![],
            loading: None,
            error: None,
            not_found: None,
            templates: vec![],
            pathname: "/test".to_string(),
        };

        let props = utils::create_page_props(&route_match, &context).unwrap();
        assert!(props.get("params").is_some());
        assert!(props.get("searchParams").is_some());
    }
}
