use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Instant,
};

use axum::http::HeaderMap;
use futures::stream::{self, StreamExt};
use rari_error::RariError;
use rustc_hash::FxHashMap;
use tokio::sync::{Mutex, OnceCell};

use crate::{
    rendering::layout::{
        LayoutRenderContext, LayoutRenderer, drain_chunked_stream, types::RenderResult,
    },
    server::{
        ServerState,
        cache::response,
        middleware::request_context::RequestContext,
        routing::{AppRouteMatch, AppRouter, app::collect_page_metadata, types::ParamValue},
    },
};

const WARMUP_CONCURRENCY: usize = 10;

fn is_warmup_interrupted(error: &RariError) -> bool {
    error.get_property("cancelled") == Some("true")
}

fn wrap_warmup_render_error(error: &RariError) -> RariError {
    let cancelled = error.get_property("cancelled") == Some("true");
    let mut wrapped = RariError::internal(format!("Render failed: {error}"));
    if cancelled {
        wrapped.set_property("cancelled", "true");
    }
    wrapped
}

/// Serialize warmup renders so concurrent warmup tasks cannot interleave on shared V8 globals.
static WARMUP_RENDER_LOCK: OnceCell<Arc<Mutex<()>>> = OnceCell::const_new();

async fn warmup_render_lock() -> Arc<Mutex<()>> {
    Arc::clone(WARMUP_RENDER_LOCK.get_or_init(|| async { Arc::new(Mutex::new(())) }).await)
}

async fn merge_warmup_cache_tags(state: &ServerState, base_tags: Vec<String>) -> Vec<String> {
    let page_cache_tags = {
        let renderer = state.renderer.lock().await;
        let runtime = Arc::clone(&renderer.runtime);
        drop(renderer);
        runtime.collect_page_cache_tags().await.unwrap_or_default()
    };

    response::RouteCachePolicy::merge_cache_tags(base_tags, &page_cache_tags)
}

pub async fn warm_cache(state: &ServerState) {
    let Some(app_router) = &state.app_router else {
        tracing::info!("[rari] Cache warmup: No app router available, skipping");
        return;
    };

    let paths = app_router.warmup_paths();

    if paths.is_empty() {
        tracing::info!("[rari] Cache warmup: No routes to warm");
        return;
    }

    tracing::info!("[rari] Cache warmup: Pre-rendering {} routes...", paths.len());
    let start = Instant::now();

    let success_count = Arc::new(AtomicUsize::new(0));
    let error_count = Arc::new(AtomicUsize::new(0));

    stream::iter(paths.iter())
        .for_each_concurrent(WARMUP_CONCURRENCY, |path| {
            let success_count = Arc::clone(&success_count);
            let error_count = Arc::clone(&error_count);
            async move {
                match warm_route(state, app_router, path).await {
                    Ok(()) => {
                        success_count.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) if is_warmup_interrupted(&e) => {
                        tracing::debug!(
                            "[rari] Cache warmup: interrupted while warming '{}': {}",
                            path,
                            e
                        );
                    }
                    Err(e) => {
                        tracing::error!("[rari] Cache warmup: Failed to warm '{}': {}", path, e);
                        error_count.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        })
        .await;

    let elapsed = start.elapsed();
    tracing::info!(
        "[rari] Cache warmup: Completed in {:.1}ms ({} succeeded, {} failed)",
        elapsed.as_secs_f64() * 1000.0,
        success_count.load(Ordering::Relaxed),
        error_count.load(Ordering::Relaxed),
    );
}

#[expect(clippy::too_many_lines)]
async fn warm_route(
    state: &ServerState,
    app_router: &Arc<AppRouter>,
    path: &str,
) -> Result<(), RariError> {
    let route_match = app_router.match_route(path)?;

    if route_match.loading.is_some() {
        return Ok(());
    }

    let mut context = create_warmup_context(&route_match);

    let layout_renderer = LayoutRenderer::with_shared_cache(
        Arc::clone(&state.renderer),
        Arc::clone(&state.layout_html_cache),
    );

    let request_context =
        Arc::new(RequestContext::new(route_match.route.path.clone()).without_layout_html_cache());

    let _render_guard = warmup_render_lock().await.lock_owned().await;

    context.metadata = collect_page_metadata(state, &route_match, &context).await;

    let render_result = layout_renderer
        .render_route_with_streaming(
            &route_match,
            &context,
            Some(Arc::clone(&request_context)),
            None,
        )
        .await
        .map_err(|error| wrap_warmup_render_error(&error))?;

    let html = match render_result {
        RenderResult::Static(html) => html,
        RenderResult::Chunked { shell, closing, mut chunks } => {
            match drain_chunked_stream(shell, closing, &mut chunks).await {
                Ok(html) => html,
                Err(error) => {
                    tracing::warn!(
                        "Skipping cache warmup for {path}: chunked stream failed: {error}"
                    );
                    return Ok(());
                }
            }
        }
    };

    let html_cache_key = response::ResponseCache::generate_cache_key(path, None);
    let cache_control = state.config.get_cache_control_for_route(path);
    let cache_policy = response::RouteCachePolicy::from_cache_control(cache_control, path);
    let for_response_cache = cache_policy.enabled
        && state.response_cache.config.enabled
        && state.config.server.origin.is_some();

    let etag = response::ResponseCache::generate_etag(html.as_bytes());

    if for_response_cache {
        let merged_tags = merge_warmup_cache_tags(state, cache_policy.tags.clone()).await;
        let body_bytes = bytes::Bytes::from(html);

        let compressed_gzip = {
            use crate::server::compression::{CompressionEncoding, compress_body};
            let (compressed, enc) =
                compress_body(body_bytes.clone(), CompressionEncoding::Gzip).await;
            if matches!(enc, CompressionEncoding::Gzip) { Some(compressed) } else { None }
        };

        let compressed_zstd = {
            use crate::server::compression::{CompressionEncoding, compress_body};
            let (compressed, enc) =
                compress_body(body_bytes.clone(), CompressionEncoding::Zstd).await;
            if matches!(enc, CompressionEncoding::Zstd) { Some(compressed) } else { None }
        };

        let compressed_br = {
            use crate::server::compression::{CompressionEncoding, compress_body};
            let (compressed, enc) =
                compress_body(body_bytes.clone(), CompressionEncoding::Brotli).await;
            if matches!(enc, CompressionEncoding::Brotli) { Some(compressed) } else { None }
        };

        response::insert_static_fast_cache(
            &state.static_fast_cache,
            path,
            Arc::new(response::PrebuiltResponse {
                identity: body_bytes.clone(),
                gzip: compressed_gzip.clone(),
                br: compressed_br.clone(),
                zstd: compressed_zstd.clone(),
                etag: etag.clone(),
                content_type: "text/html; charset=utf-8".to_string(),
                cache_control: cache_control.to_string(),
                is_not_found: false,
                cached_at: Instant::now(),
            }),
            state.response_cache.config.max_entries,
        );

        let cached_response = response::CachedResponse {
            body: body_bytes,
            headers: HeaderMap::new(),
            metadata: response::CacheMetadata {
                cached_at: Instant::now(),
                ttl: cache_policy.ttl,
                etag: Some(etag),
                tags: merged_tags.clone(),
            },
            compressed_zstd,
            compressed_br,
            compressed_gzip,
        };

        state.response_cache.set(html_cache_key, cached_response).await;
    }

    Ok(())
}

fn create_warmup_context(route_match: &AppRouteMatch) -> LayoutRenderContext {
    let mut params: FxHashMap<String, ParamValue> = FxHashMap::default();

    for (key, value) in &route_match.params {
        params.insert(key.clone(), value.clone());
    }

    LayoutRenderContext {
        params,
        search_params: FxHashMap::default(),
        headers: FxHashMap::default(),
        pathname: route_match.pathname.clone(),
        template_navigation_id: None,
        metadata: None,
    }
}
