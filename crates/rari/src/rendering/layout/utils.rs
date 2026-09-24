use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};

use bytes::Bytes;
use cow_utils::CowUtils;
use rari_error::RariError;
use rustc_hash::FxHashMap;
use serde_json::Value;
use tokio::sync::mpsc::Receiver;

use super::LayoutRenderContext;
use crate::server::{
    core::utils::component::{readable_component_id, short_hash},
    routing::{app_router::AppRouteMatch, types::ParamValue},
};

pub fn generate_cache_key(
    route_match: &AppRouteMatch,
    context: &LayoutRenderContext,
    cookie_header: Option<&str>,
) -> u64 {
    let mut hasher = DefaultHasher::new();

    route_match.route.path.hash(&mut hasher);

    let mut params: Vec<_> = context.params.iter().collect();
    params.sort_by_key(|(k, _)| *k);
    for (k, v) in params {
        k.hash(&mut hasher);
        v.hash(&mut hasher);
    }

    let mut search_params: Vec<_> = context.search_params.iter().collect();
    search_params.sort_by_key(|(k, _)| *k);
    for (k, v) in search_params {
        k.hash(&mut hasher);
        v.hash(&mut hasher);
    }

    if let Some(cookie_header) = cookie_header.filter(|value| !value.is_empty()) {
        cookie_header.hash(&mut hasher);
    }

    hasher.finish()
}

pub fn normalize_route_component_path(file_path: &str) -> String {
    let normalized = file_path.cow_replace('\\', "/").into_owned();
    if normalized.starts_with("src/") {
        normalized
    } else if normalized.starts_with("app/") {
        format!("src/{normalized}")
    } else {
        format!("src/app/{normalized}")
    }
}

pub fn create_component_id(file_path: &str) -> String {
    let project_relative_path = normalize_route_component_path(file_path);
    format!(
        "{}_{}",
        readable_component_id(&project_relative_path),
        short_hash(&project_relative_path)
    )
}

pub fn component_dist_path(base_path: &Path, file_path: &str) -> PathBuf {
    base_path.join(format!("{}.js", create_component_id(file_path)))
}

pub fn create_page_props(
    route_match: &AppRouteMatch,
    context: &LayoutRenderContext,
) -> Result<Value, RariError> {
    let params_value = if route_match.params.is_empty() {
        Value::Object(serde_json::Map::new())
    } else {
        serde_json::to_value(&route_match.params)?
    };

    let search_params_value = if context.search_params.is_empty() {
        Value::Object(serde_json::Map::new())
    } else {
        serde_json::to_value(&context.search_params)?
    };

    let result = serde_json::json!({
        "params": params_value,
        "searchParams": search_params_value
    });
    Ok(result)
}

#[expect(
    clippy::implicit_hasher,
    reason = "FxHashMap is the specific hasher needed for LayoutRenderContext"
)]
pub fn create_layout_context(
    params: FxHashMap<String, ParamValue>,
    search_params: FxHashMap<String, Vec<String>>,
    headers: FxHashMap<String, String>,
    pathname: String,
) -> LayoutRenderContext {
    LayoutRenderContext {
        params,
        search_params,
        headers,
        pathname,
        template_navigation_id: None,
        metadata: None,
    }
}

pub async fn drain_chunked_stream(
    shell: Bytes,
    closing: Bytes,
    chunks: &mut Receiver<Result<Vec<u8>, RariError>>,
) -> Result<String, RariError> {
    let mut output = String::from_utf8_lossy(&shell).into_owned();

    while let Some(chunk_result) = chunks.recv().await {
        match chunk_result {
            Ok(data) => output.push_str(&String::from_utf8_lossy(&data)),
            Err(error) => return Err(error),
        }
    }

    output.push_str(&String::from_utf8_lossy(&closing));
    Ok(output)
}
