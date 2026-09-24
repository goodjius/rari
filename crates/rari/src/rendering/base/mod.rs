pub mod constants;
pub mod loader;
pub mod renderer;
pub mod renderer_lock;
pub mod sanitizer;
pub mod types;
pub mod utils;

pub use loader::{RscJsLoader, RscModuleOperation, StubType};
pub use renderer::RscRenderer;
pub use renderer_lock::{run_with_renderer, run_with_renderer_result};
pub use sanitizer::sanitize_html_output;
pub use types::{ResourceLimits, ResourceMetrics, ResourceTracker};

#[cfg(test)]
#[expect(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use std::sync::Arc;

    use super::renderer::RscRenderer;
    use crate::runtime::JsExecutionRuntime;

    #[tokio::test]
    async fn test_renderer_initialization() {
        let runtime = Arc::new(JsExecutionRuntime::new(None));

        let mut renderer = RscRenderer::new(runtime);

        let result = renderer.initialize().await;
        assert!(result.is_ok());
        assert!(renderer.initialized);
    }

    #[tokio::test]
    async fn test_render_to_readable_stream() {
        let runtime = Arc::new(JsExecutionRuntime::new(None));
        let mut renderer = RscRenderer::new(runtime);

        renderer.initialize().await.expect("Failed to initialize renderer");

        assert!(renderer.initialized);
    }
}
