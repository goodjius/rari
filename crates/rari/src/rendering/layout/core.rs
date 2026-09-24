#![expect(clippy::missing_errors_doc)]

use std::{env, future::Future, pin::Pin, sync::Arc};

use rari_error::RariError;
use tokio::sync::{Mutex, mpsc, oneshot};

use super::{
    types::{LayoutRenderContext, PageMetadata, RenderResult},
    utils,
};
use crate::{
    rendering::base::{RscRenderer, run_with_renderer_result},
    runtime::{
        JsExecutionRuntime,
        factory::{JsRuntimeInterface, StreamingSlotGuard},
    },
    server::{
        cache::{
            handler::{
                CacheError, CacheHandler, CacheHandlerRegistry, MemoryCacheHandler, MemoryConfig,
            },
            response::RouteCachePolicy,
        },
        config::{CacheLayerConfig, Config},
        middleware::request_context::RequestContext,
        routing::app_router::AppRouteMatch,
    },
    utils::path::path_to_file_url,
};

mod solid_core;

const LAYOUT_KEY_PREFIX: &str = "layout:";

fn should_use_layout_html_cache(
    context: &LayoutRenderContext,
    request_context: Option<&RequestContext>,
) -> bool {
    if request_context.is_some_and(|ctx| ctx.skip_layout_html_cache) {
        return false;
    }

    let Some(config) = Config::get() else {
        return true;
    };

    let cache_control = config.get_cache_control_for_route(&context.pathname);
    RouteCachePolicy::from_cache_control(cache_control, &context.pathname).enabled
}
pub struct LayoutHtmlCache {
    handler: Arc<dyn CacheHandler>,
    default_ttl_secs: u64,
}

impl Default for LayoutHtmlCache {
    fn default() -> Self {
        Self::new()
    }
}

impl LayoutHtmlCache {
    pub fn new() -> Self {
        Self::with_ttl(
            Arc::new(MemoryCacheHandler::with_config(&MemoryConfig {
                max_entries: 5000,
                default_ttl: 3600,
                ..Default::default()
            })),
            3600,
        )
    }

    pub fn from_config(layer: &CacheLayerConfig, registry: &CacheHandlerRegistry) -> Self {
        let handler = registry.resolve_configured(&layer.handler, &layer.memory_config());
        Self::with_ttl(handler, layer.default_ttl_secs)
    }

    pub fn with_handler(handler: Arc<dyn CacheHandler>) -> Self {
        Self::with_ttl(handler, 3600)
    }

    pub fn with_ttl(handler: Arc<dyn CacheHandler>, default_ttl_secs: u64) -> Self {
        Self { handler, default_ttl_secs }
    }

    fn namespaced(key: u64) -> String {
        format!("{LAYOUT_KEY_PREFIX}{key}")
    }

    pub async fn get(&self, key: u64) -> Option<String> {
        let ns_key = Self::namespaced(key);
        let bytes = match self.handler.get(&ns_key).await {
            Ok(Some(b)) => b,
            Ok(None) => return None,
            Err(e) => {
                tracing::debug!(key = %ns_key, error = %e, "layout cache get failed");
                return None;
            }
        };
        match String::from_utf8(bytes) {
            Ok(s) => Some(s),
            Err(e) => {
                tracing::debug!(key = %ns_key, error = %e, "layout cache value not valid utf-8");
                None
            }
        }
    }

    pub async fn insert(&self, key: u64, html: String) -> Result<(), CacheError> {
        self.insert_with_tags(key, html, &[], None).await
    }

    /// `route_max_age_secs` is the route's declared Cache-Control max-age, if
    /// any. Entries never outlive the route's own freshness contract: the
    /// effective TTL is min(route max-age, layer default), so a max-age=60
    /// route can't be served hour-old layout HTML. Routes without a max-age
    /// keep the layer default.
    pub async fn insert_with_tags(
        &self,
        key: u64,
        html: String,
        tags: &[String],
        route_max_age_secs: Option<u64>,
    ) -> Result<(), CacheError> {
        let ttl_secs =
            route_max_age_secs.map_or(self.default_ttl_secs, |m| m.min(self.default_ttl_secs));
        if ttl_secs == 0 {
            // max-age=0: the entry would be born expired; skip the write.
            return Ok(());
        }
        self.handler
            .set_with_tags(&Self::namespaced(key), html.into_bytes(), ttl_secs, tags)
            .await?;
        Ok(())
    }

    pub async fn clear(&self) -> Result<(), CacheError> {
        self.handler.clear_prefix(LAYOUT_KEY_PREFIX).await?;
        Ok(())
    }

    pub async fn invalidate_by_tag(&self, tag: &str) -> Result<(), CacheError> {
        self.handler.invalidate_by_tag(tag).await
    }
}

fn wrap_streaming_script(request_id: Option<&str>, stream_id: &str, script: &str) -> String {
    let request_id_json = serde_json::to_string(request_id.unwrap_or(stream_id))
        .unwrap_or_else(|_| "\"\"".to_string());
    let stream_id_json = serde_json::to_string(stream_id).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r"(async function() {{
            const __RARI_REQUEST_ID__ = {request_id_json};
            const __RARI_STREAM_ID__ = {stream_id_json};
            const storage = globalThis['~rari']?.requestStorage;
            const body = async () => await ({script});
            if (storage && typeof storage.run === 'function') {{
                return await storage.run(
                    {{ requestId: __RARI_REQUEST_ID__, streamId: __RARI_STREAM_ID__ }},
                    body,
                );
            }}
            return await body();
        }})()"
    )
}

async fn queue_streaming_script(
    runtime: &Arc<JsExecutionRuntime>,
    request_context: Option<Arc<RequestContext>>,
    script_name: String,
    stream_id: String,
    script: String,
    chunk_sender: mpsc::Sender<Result<Vec<u8>, RariError>>,
) -> Result<
    (Pin<Box<dyn Future<Output = Result<(), RariError>> + Send>>, StreamingSlotGuard),
    RariError,
> {
    let err_sender = chunk_sender.clone();
    let (handle, stream_lease) = match runtime.pick_runtime_for_streaming().await {
        Ok(picked) => picked,
        Err(e) => {
            let _ = err_sender.send(Err(e.clone())).await;
            return Err(e);
        }
    };
    if let Some(context) = request_context {
        let request_id = context.request_id().to_string();
        let wrapped = wrap_streaming_script(Some(&request_id), &stream_id, &script);
        let completion = match handle
            .queue_script_for_streaming(
                stream_id,
                script_name,
                wrapped,
                chunk_sender,
                Some(Arc::clone(&context)),
            )
            .await
        {
            Ok(completion) => completion,
            Err(e) => {
                let _ = err_sender.send(Err(e.clone())).await;
                return Err(e);
            }
        };
        let completion = Box::pin(async move {
            let result = completion.await;
            let clear_result = handle.unregister_request_context(&request_id).await;
            result?;
            clear_result
        }) as Pin<Box<dyn Future<Output = Result<(), RariError>> + Send>>;
        Ok((completion, stream_lease))
    } else {
        let wrapped = wrap_streaming_script(None, &stream_id, &script);
        let completion = match handle
            .queue_script_for_streaming(stream_id, script_name, wrapped, chunk_sender, None)
            .await
        {
            Ok(completion) => completion,
            Err(e) => {
                let _ = err_sender.send(Err(e.clone())).await;
                return Err(e);
            }
        };
        Ok((completion, stream_lease))
    }
}

pub struct LayoutRenderer {
    renderer: Arc<Mutex<RscRenderer>>,
    html_cache: Arc<LayoutHtmlCache>,
}

impl LayoutRenderer {
    pub fn new(renderer: Arc<Mutex<RscRenderer>>) -> Self {
        Self { renderer, html_cache: Arc::new(LayoutHtmlCache::new()) }
    }

    pub fn with_shared_cache(
        renderer: Arc<Mutex<RscRenderer>>,
        html_cache: Arc<LayoutHtmlCache>,
    ) -> Self {
        Self { renderer, html_cache }
    }

    pub fn create_shared_cache() -> Arc<LayoutHtmlCache> {
        Arc::new(LayoutHtmlCache::new())
    }

    pub fn create_shared_cache_from_config(
        layer: &CacheLayerConfig,
        registry: &CacheHandlerRegistry,
    ) -> Arc<LayoutHtmlCache> {
        Arc::new(LayoutHtmlCache::from_config(layer, registry))
    }

    pub async fn check_page_not_found(
        &self,
        route_match: &AppRouteMatch,
        context: &LayoutRenderContext,
    ) -> Result<bool, RariError> {
        self.check_page_not_found_on(route_match, context, None).await
    }

    /// Prefer [`Self::check_page_not_found_on`] with a sticky runtime when the caller
    /// already holds a pool slot lease, using the pool here would re-acquire it and deadlock.
    pub async fn check_page_not_found_on(
        &self,
        route_match: &AppRouteMatch,
        context: &LayoutRenderContext,
        sticky_runtime: Option<&Arc<dyn JsRuntimeInterface>>,
    ) -> Result<bool, RariError> {
        let page_props = utils::create_page_props(route_match, context)?;
        let page_props_json = serde_json::to_string(&page_props)?;

        let dist_server_path = env::current_dir()
            .ok()
            .map(|p| p.join("dist/server"))
            .and_then(|p| p.canonicalize().ok());

        let Some(base_path) = dist_server_path else {
            return Ok(false);
        };

        let page_file_path = utils::component_dist_path(&base_path, &route_match.route.file_path);

        if !page_file_path.exists() {
            return Ok(false);
        }

        let page_path = path_to_file_url(&page_file_path);

        let check_script = format!(
            r#"
            (async () => {{
                try {{
                    const module = await import("{page_path}");

                    if (typeof module.getData === 'function') {{
                        const pageProps = {page_props_json};
                        const result = await module.getData(pageProps);
                        return {{ notFound: result?.notFound === true }};
                    }}

                    return {{ notFound: false }};
                }} catch (error) {{
                    console.error('[check_page_not_found] Error:', error);
                    return {{ notFound: false }};
                }}
            }})()
            "#
        );

        let result = if let Some(runtime) = sticky_runtime {
            runtime.execute_script("check_not_found".to_string(), check_script).await?
        } else {
            let renderer = self.renderer.lock().await;
            let runtime = Arc::clone(&renderer.runtime);
            drop(renderer);
            runtime.execute_script("check_not_found".to_string(), check_script).await?
        };

        let not_found =
            result.get("notFound").and_then(serde_json::Value::as_bool).unwrap_or(false);

        Ok(not_found)
    }

    pub async fn render_route_with_streaming(
        &self,
        route_match: &AppRouteMatch,
        context: &LayoutRenderContext,
        request_context: Option<Arc<RequestContext>>,
        metadata_rx: Option<oneshot::Receiver<Option<PageMetadata>>>,
    ) -> Result<RenderResult, RariError> {
        let cookie_header = request_context.as_deref().and_then(|ctx| ctx.cookie_header.as_deref());
        let cache_key = utils::generate_cache_key(route_match, context, cookie_header);

        if should_use_layout_html_cache(context, request_context.as_deref())
            && let Some(cached_html) = self.html_cache.get(cache_key).await
        {
            return Ok(RenderResult::Static(cached_html));
        }

        self.render_solid_route_with_streaming(route_match, context, request_context, metadata_rx)
            .await
    }

    pub async fn component_exists(&self, component_id: &str) -> bool {
        let renderer = self.renderer.lock().await;
        renderer.component_exists(component_id)
    }

    pub async fn register_component(
        &self,
        component_id: &str,
        component_code: &str,
    ) -> Result<(), RariError> {
        let component_id = component_id.to_string();
        let component_code = component_code.to_string();
        run_with_renderer_result(Arc::clone(&self.renderer), move |renderer| async move {
            renderer.register_component(&component_id, &component_code).await
        })
        .await
    }
}

#[cfg(test)]
#[expect(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::server::cache::handler::NoOpCacheHandler;

    #[tokio::test]
    async fn test_layout_handler_round_trip() {
        let cache = LayoutHtmlCache::new();
        let html = "<!DOCTYPE html><html><body>hi</body></html>".to_string();

        cache.insert(42, html.clone()).await.expect("insert");
        let got = cache.get(42).await.expect("get");
        assert_eq!(got, html);

        assert!(cache.get(9999).await.is_none());
    }

    #[tokio::test]
    async fn test_layout_clear() {
        let cache = LayoutHtmlCache::new();
        cache.insert(1, "one".to_string()).await.expect("insert");
        cache.insert(2, "two".to_string()).await.expect("insert");
        cache.insert(3, "three".to_string()).await.expect("insert");

        assert!(cache.get(1).await.is_some());
        assert!(cache.get(2).await.is_some());
        assert!(cache.get(3).await.is_some());

        cache.clear().await.expect("clear");

        assert!(cache.get(1).await.is_none());
        assert!(cache.get(2).await.is_none());
        assert!(cache.get(3).await.is_none());
    }

    #[tokio::test]
    async fn test_layout_with_noop_handler() {
        let cache = LayoutHtmlCache::with_handler(Arc::new(NoOpCacheHandler));

        cache.insert(1, "x".to_string()).await.expect("insert is no-op but Ok");
        assert!(cache.get(1).await.is_none());
        cache.clear().await.expect("clear is no-op but Ok");
    }

    #[tokio::test]
    async fn test_layout_custom_ttl_passes_through() {
        let handler = Arc::new(MemoryCacheHandler::default());
        let cache = LayoutHtmlCache::with_ttl(handler, 60);
        cache.insert(7, "alive".to_string()).await.expect("insert");
        assert!(cache.get(7).await.is_some());
    }

    #[tokio::test]
    async fn test_layout_route_max_age_clamps_ttl() {
        let handler = Arc::new(MemoryCacheHandler::default());
        let cache = LayoutHtmlCache::with_ttl(Arc::clone(&handler) as Arc<_>, 3600);

        // max-age=0: the entry would be born expired, so the write is skipped
        // entirely, nothing stored, nothing served.
        cache.insert_with_tags(1, "short-lived".to_string(), &[], Some(0)).await.expect("insert");
        assert!(cache.get(1).await.is_none());
        assert!(handler.is_empty(), "max-age=0 must not store an entry");

        // A max-age above the default is clamped down to it, never up.
        cache
            .insert_with_tags(2, "default-lived".to_string(), &[], Some(999_999))
            .await
            .expect("insert");
        assert!(cache.get(2).await.is_some());

        // No max-age keeps the layer default.
        cache.insert_with_tags(3, "default".to_string(), &[], None).await.expect("insert");
        assert!(cache.get(3).await.is_some());
    }

    #[tokio::test]
    async fn test_layout_invalidate_by_tag() {
        let cache = LayoutHtmlCache::new();
        cache
            .insert_with_tags(42, "tagged".to_string(), &["products".to_string()], None)
            .await
            .expect("insert");
        assert!(cache.get(42).await.is_some());

        cache.invalidate_by_tag("products").await.expect("invalidate");
        assert!(cache.get(42).await.is_none());
    }

    #[tokio::test]
    async fn test_layout_clear_removes_all_layout_keys() {
        let cache = LayoutHtmlCache::new();
        for i in 0..50 {
            cache.insert(i, format!("v{i}")).await.expect("insert");
        }
        cache.clear().await.expect("clear");
        for i in 0..50 {
            assert!(cache.get(i).await.is_none(), "key {i} survived clear");
        }
    }
}
