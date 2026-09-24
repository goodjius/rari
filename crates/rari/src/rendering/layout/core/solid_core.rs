//! Solid counterpart to the React route-rendering branches in the parent
//! module: composition happens in JS (`layout/js/solid_route.ts`), Rust only
//! resolves component ids/props, builds the head fragment and streams.
//! A child module of `core` so it can reach `LayoutRenderer`'s private state
//! and the streaming-script helpers.

use std::sync::Arc;

use bytes::Bytes;
use rari_error::RariError;
use serde_json::{Value, json};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

use super::{LayoutRenderer, queue_streaming_script};
use crate::{
    RscHtmlRenderer,
    rendering::{
        base::run_with_renderer_result,
        layout::{
            types::{LayoutRenderContext, PageMetadata, RenderResult},
            utils,
        },
    },
    server::{
        config::Config, middleware::request_context::RequestContext,
        routing::app_router::AppRouteMatch,
    },
};

/// Component ids and props for one route, as consumed by `renderSolidRouteStreaming`.
pub(super) fn solid_route_options(
    route_match: &AppRouteMatch,
    context: &LayoutRenderContext,
    loading_enabled: bool,
) -> Result<Value, RariError> {
    let is_not_found = route_match.not_found.is_some();

    let (page_id, props) = if let Some(not_found) = &route_match.not_found {
        (utils::create_component_id(&not_found.file_path), json!({}))
    } else {
        let props = utils::create_page_props(route_match, context).map_err(|e| {
            RariError::internal(format!(
                "Failed to create page props for route '{}': {e}",
                route_match.route.path
            ))
        })?;
        (utils::create_component_id(&route_match.route.file_path), props)
    };

    let layout_ids: Vec<String> = route_match
        .layouts
        .iter()
        .map(|layout| utils::create_component_id(&layout.file_path))
        .collect();
    let template_ids: Vec<String> = route_match
        .templates
        .iter()
        .map(|template| utils::create_component_id(&template.file_path))
        .collect();

    let loading_id = if loading_enabled && !is_not_found {
        route_match.loading.as_ref().map(|entry| utils::create_component_id(&entry.file_path))
    } else {
        None
    };
    let error_id = if is_not_found {
        None
    } else {
        route_match.error.as_ref().map(|entry| utils::create_component_id(&entry.file_path))
    };

    let metadata =
        context.metadata.as_ref().and_then(|m| serde_json::to_value(m).ok()).unwrap_or(Value::Null);

    Ok(json!({
        "pageId": page_id,
        "layoutIds": layout_ids,
        "templateIds": template_ids,
        "loadingId": loading_id,
        "errorId": error_id,
        "props": props,
        "pathname": context.pathname,
        "metadata": metadata,
    }))
}

impl LayoutRenderer {
    /// Streams a route rendered by Solid as chunked HTML. The loading
    /// component (if any) becomes the Suspense fallback; not-found and error
    /// pages are composed inside the root layout so the output is always a
    /// full document.
    pub(super) async fn render_solid_route_with_streaming(
        &self,
        route_match: &AppRouteMatch,
        context: &LayoutRenderContext,
        request_context: Option<Arc<RequestContext>>,
        metadata_rx: Option<oneshot::Receiver<Option<PageMetadata>>>,
    ) -> Result<RenderResult, RariError> {
        let config = Config::get().ok_or_else(|| RariError::internal("Config not available"))?;

        let mut context = context.clone();
        if let Some(mut rx) = metadata_rx
            && let Ok(metadata) = rx.try_recv()
        {
            context.metadata = metadata;
        }

        let mut options = solid_route_options(route_match, &context, config.loading.enabled)?;

        let (chunk_sender, chunk_receiver) = mpsc::channel::<Result<Vec<u8>, RariError>>(128);
        let stream_id = Uuid::new_v4().to_string();
        let shell = Bytes::from_static(b"<!DOCTYPE html>");

        let route_match = route_match.clone();
        let prepared =
            run_with_renderer_result(Arc::clone(&self.renderer), move |renderer| async move {
                renderer.ensure_solid_pipeline().await?;

                let html_renderer = RscHtmlRenderer::with_public_dir(
                    Arc::clone(&renderer.runtime),
                    config.public_dir().clone(),
                );
                let css_links = RscHtmlRenderer::css_links_for_route(&route_match);
                let template = html_renderer
                    .load_template(
                        config.rsc_html.cache_template,
                        config.is_development(),
                        &config.vite.host,
                        config.vite.port,
                    )
                    .await?;
                let template = RscHtmlRenderer::inject_css_links(&template, &css_links);
                let head_content = RscHtmlRenderer::client_head_fragment(&template).to_string();

                Ok((Arc::clone(&renderer.runtime), head_content))
            })
            .await;

        let (runtime, head_content) = match prepared {
            Ok(prepared) => prepared,
            Err(e) => {
                tracing::error!("Solid route streaming setup error: {e}");
                let _ = chunk_sender
                    .send(Err(RariError::internal(format!("Solid streaming setup failed: {e}"))))
                    .await;
                return Ok(RenderResult::Chunked {
                    shell,
                    closing: Bytes::new(),
                    chunks: chunk_receiver,
                });
            }
        };

        if let Some(map) = options.as_object_mut() {
            map.insert("headContent".to_string(), Value::String(head_content));
        }
        let options_json = serde_json::to_string(&options)
            .map_err(|e| RariError::serialization(format!("Solid route options: {e}")))?;

        // `__RARI_STREAM_ID__` is defined by `wrap_streaming_script`.
        let script = format!(
            r"(async function() {{
                try {{
                    await renderSolidRouteStreaming({{ ...{options_json}, streamId: __RARI_STREAM_ID__ }});
                }} catch (error) {{
                    console.error('[rari] Solid route render failed:', error);
                    const message = String((error && error.message) || error).split('<').join('&lt;');
                    await Deno.core.ops.op_stream_chunk(
                        __RARI_STREAM_ID__,
                        '<html><head></head><body><div class=rari-error style=color:red>Error loading content: ' + message + '</div></body></html>',
                    );
                    Deno.core.ops.op_stream_done(__RARI_STREAM_ID__);
                }}
            }})()"
        );

        match queue_streaming_script(
            &runtime,
            request_context,
            "solid_route_stream".to_string(),
            stream_id,
            script,
            chunk_sender.clone(),
        )
        .await
        {
            Ok((completion, stream_lease)) => {
                tokio::spawn(async move {
                    let _stream_lease = stream_lease;
                    if let Err(e) = completion.await {
                        tracing::error!("Solid route streaming error: {e}");
                    }
                });
            }
            Err(e) => tracing::error!("Solid route streaming queue error: {e}"),
        }

        Ok(RenderResult::Chunked { shell, closing: Bytes::new(), chunks: chunk_receiver })
    }
}
