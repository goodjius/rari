#![expect(clippy::missing_errors_doc, clippy::too_many_lines)]

use std::{env, fmt::Write, str, sync::Arc};

use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{HeaderMap, StatusCode, Uri, header},
    response::Response,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use cow_utils::CowUtils;
use rari_error::RariError;
use serde::Serialize;
use serde_json::Value;

use crate::{
    rendering::base::{
        renderer::{parse_solid_action_outcome, solid_action_script},
        run_with_renderer_result,
    },
    runtime::{JsExecutionRuntime, factory::JsRuntimeInterface},
    server::{
        ServerState,
        cache::revalidate::{invalidate_route_caches, invalidate_route_caches_on},
        config::RedirectConfig,
        core::utils::http::{extract_headers, is_origin_allowed},
        error_response,
        middleware::request_context::{PendingCookie, PendingCookieKey, RequestContext},
    },
};

#[derive(Debug, Serialize)]
#[non_exhaustive]
pub struct ServerActionResponse {
    pub success: bool,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub redirect: Option<String>,
}

fn effective_port(url: &url::Url) -> u16 {
    url.port().unwrap_or_else(|| match url.scheme() {
        "https" => 443,
        "http" => 80,
        _ => 0,
    })
}

fn normalize_origin(url: &url::Url) -> (String, String, u16) {
    (url.scheme().to_string(), url.host_str().unwrap_or("").to_string(), effective_port(url))
}

fn server_origin_from_headers(headers: &HeaderMap) -> Result<(String, String, u16), RariError> {
    let host = headers.get("host").and_then(|v| v.to_str().ok()).ok_or_else(|| {
        tracing::error!("Missing host header in server action request");
        RariError::bad_request("Missing host header")
    })?;

    let scheme = headers
        .get("x-forwarded-proto")
        .or_else(|| headers.get("x-forwarded-protocol"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or_else(|| {
            tracing::debug!(
                "No x-forwarded-proto header; defaulting to http for origin validation"
            );
            "http"
        });

    let server_origin_str = format!("{scheme}://{host}");
    let server_origin_url = url::Url::parse(&server_origin_str).map_err(|e| {
        tracing::error!("Failed to parse server origin: {}", e);
        RariError::internal(format!("Failed to parse server origin: {e}"))
    })?;
    Ok(normalize_origin(&server_origin_url))
}

fn origin_matches_request_host(headers: &HeaderMap, origin: &str) -> bool {
    let Ok(origin_url) = url::Url::parse(origin) else {
        return false;
    };
    let Ok(server_origin) = server_origin_from_headers(headers) else {
        return false;
    };
    normalize_origin(&origin_url) == server_origin
}

fn check_origin(headers: &HeaderMap, allowed_origins: &[String]) -> Result<(), RariError> {
    if allowed_origins.is_empty() {
        let server_origin_tuple = server_origin_from_headers(headers)?;
        let server_origin_str = {
            let (scheme, host, port) = &server_origin_tuple;
            if (*scheme == "http" && *port == 80) || (*scheme == "https" && *port == 443) {
                format!("{scheme}://{host}")
            } else {
                format!("{scheme}://{host}:{port}")
            }
        };

        if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
            if let Ok(origin_url) = url::Url::parse(origin) {
                let origin_tuple = normalize_origin(&origin_url);

                if origin_tuple == server_origin_tuple {
                    return Ok(());
                }
            }
            tracing::error!(
                "Origin mismatch: origin={}, server_origin={}",
                origin,
                server_origin_str
            );
            return Err(RariError::forbidden("Origin not allowed"));
        }

        if let Some(referer) = headers.get("referer").and_then(|v| v.to_str().ok()) {
            if let Ok(referer_url) = url::Url::parse(referer) {
                let referer_tuple = normalize_origin(&referer_url);

                if referer_tuple == server_origin_tuple {
                    return Ok(());
                }
                tracing::error!(
                    "Referer mismatch: referer_origin={}://{}:{}, server_origin={}",
                    referer_tuple.0,
                    referer_tuple.1,
                    referer_tuple.2,
                    server_origin_str
                );
            } else {
                tracing::error!("Invalid referer header: failed to parse");
            }
            return Err(RariError::forbidden("Referer not allowed"));
        }

        tracing::debug!("Missing origin and referer headers in server action request");
        return Err(RariError::forbidden("Origin or referer required"));
    }

    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        if is_origin_allowed(origin, allowed_origins)
            || origin_matches_request_host(headers, origin)
        {
            return Ok(());
        }
        tracing::error!("Invalid origin: {}", origin);
        return Err(RariError::forbidden("Origin not allowed"));
    }

    if let Some(referer) = headers.get("referer").and_then(|v| v.to_str().ok()) {
        if let Ok(referer_url) = url::Url::parse(referer) {
            let (scheme, host, port) = normalize_origin(&referer_url);
            let referer_origin =
                if (scheme == "http" && port == 80) || (scheme == "https" && port == 443) {
                    format!("{scheme}://{host}")
                } else {
                    format!("{scheme}://{host}:{port}")
                };
            if is_origin_allowed(&referer_origin, allowed_origins)
                || origin_matches_request_host(headers, &referer_origin)
            {
                return Ok(());
            }
            tracing::error!("Invalid referer origin: {}", referer_origin);
        } else {
            tracing::error!("Invalid referer header: failed to parse origin");
        }
        return Err(RariError::forbidden("Referer not allowed"));
    }

    tracing::debug!("Missing Origin and Referer headers with non-empty allowed_origins");
    Err(RariError::forbidden("Origin or referer required"))
}

fn redirect_target_path(redirect_url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(redirect_url) {
        parsed.path().to_string()
    } else if redirect_url.starts_with('/') {
        redirect_url.split('?').next().unwrap_or(redirect_url).to_string()
    } else {
        redirect_url.to_string()
    }
}

async fn invalidate_redirect_target_caches(
    state: &ServerState,
    redirect_url: &str,
    sticky_runtime: Option<&Arc<dyn JsRuntimeInterface>>,
) {
    let redirect_path = redirect_target_path(redirect_url);
    let result = if let Some(runtime) = sticky_runtime {
        invalidate_route_caches_on(state, &redirect_path, runtime).await
    } else {
        invalidate_route_caches(state, &redirect_path).await
    };
    if let Err(e) = result {
        tracing::warn!(
            error = %e,
            path = %redirect_path,
            "route cache invalidation failed after server action redirect"
        );
    }
}

const ACTION_FORM_STATE_COOKIE: &str = "rari-action-form-state";
fn action_form_state_cookie_secure() -> bool {
    env::var("NODE_ENV").map(|value| value == "production").unwrap_or(false)
}

fn encode_action_form_state_cookie_value(form_state: &Value) -> Option<String> {
    let json = serde_json::to_string(form_state).ok()?;
    Some(BASE64_STANDARD.encode(json))
}

fn decode_action_form_state_cookie_value(encoded: &str) -> Option<Value> {
    if let Ok(bytes) = BASE64_STANDARD.decode(encoded) {
        if let Ok(value) = serde_json::from_slice(&bytes) {
            return Some(value);
        }
    }

    serde_json::from_str(encoded).ok()
}

pub fn stage_action_form_state_cookie(
    pending_cookies: &dashmap::DashMap<PendingCookieKey, PendingCookie>,
    form_state: &Value,
) {
    let Some(encoded) = encode_action_form_state_cookie_value(form_state) else {
        return;
    };

    let secure = action_form_state_cookie_secure();

    pending_cookies.insert(
        PendingCookieKey::new(ACTION_FORM_STATE_COOKIE, Some("/"), None),
        PendingCookie {
            name: ACTION_FORM_STATE_COOKIE.to_string(),
            value: encoded,
            path: Some("/".to_string()),
            domain: None,
            expires: None,
            max_age: Some(60),
            http_only: true,
            secure,
            same_site: Some("Lax".to_string()),
            priority: None,
            partitioned: false,
        },
    );
}

pub fn clear_action_form_state_cookie(
    pending_cookies: &dashmap::DashMap<PendingCookieKey, PendingCookie>,
) {
    let secure = action_form_state_cookie_secure();

    pending_cookies.insert(
        PendingCookieKey::new(ACTION_FORM_STATE_COOKIE, Some("/"), None),
        PendingCookie {
            name: ACTION_FORM_STATE_COOKIE.to_string(),
            value: String::new(),
            path: Some("/".to_string()),
            domain: None,
            expires: None,
            max_age: Some(0),
            http_only: true,
            secure,
            same_site: Some("Lax".to_string()),
            priority: None,
            partitioned: false,
        },
    );
}

fn read_cookie_value(cookie_header: &str, name: &str) -> Option<String> {
    for part in cookie_header.split(';') {
        let trimmed = part.trim();
        if let Some((key, value)) = trimmed.split_once('=')
            && key == name
        {
            return Some(value.to_string());
        }
    }
    None
}

pub fn has_action_form_state_cookie(cookie_header: Option<&str>) -> bool {
    let Some(cookie_header) = cookie_header else {
        return false;
    };

    read_cookie_value(cookie_header, ACTION_FORM_STATE_COOKIE).is_some()
}

pub fn response_cache_cookie_partition(cookie_header: Option<&str>) -> Option<String> {
    let cookie_header = cookie_header.filter(|value| !value.is_empty())?;
    let form_state = read_cookie_value(cookie_header, ACTION_FORM_STATE_COOKIE)?;
    Some(format!("{ACTION_FORM_STATE_COOKIE}={form_state}"))
}

pub fn parse_action_form_state_from_cookie(cookie_header: Option<&str>) -> Option<Value> {
    let cookie_header = cookie_header.filter(|value| !value.is_empty())?;
    let encoded = read_cookie_value(cookie_header, ACTION_FORM_STATE_COOKIE)?;
    decode_action_form_state_cookie_value(&encoded)
}

pub fn action_form_state_sync_script(form_state: Option<&Value>) -> String {
    match form_state {
        Some(state) => format!(
            "globalThis['~rari'] = globalThis['~rari'] || {{}}; globalThis['~rari'].actionFormState = {state};"
        ),
        None => "if (globalThis['~rari']) delete globalThis['~rari'].actionFormState;".to_string(),
    }
}

fn action_export_name(action_id: &str) -> &str {
    action_id.rsplit_once('#').map_or("default", |(_, export_name)| export_name)
}

fn rpc_action_error_response(
    error: &RariError,
    is_development: bool,
    pending_cookies: Option<&dashmap::DashMap<PendingCookieKey, PendingCookie>>,
) -> Response {
    #[expect(clippy::expect_used, reason = "Response::builder() with valid components never fails")]
    let mut response = Response::builder()
        .status(error_response::status(error))
        .header(header::CONTENT_TYPE, "text/plain;charset=UTF-8")
        .header(header::CACHE_CONTROL, "no-store, no-cache, must-revalidate, private")
        .body(Body::from(error.safe_message(is_development)))
        .expect("Valid error response");
    if let Some(pending_cookies) = pending_cookies {
        append_pending_cookies(response.headers_mut(), pending_cookies);
    }
    response
}

fn is_server_action_request(headers: &HeaderMap) -> bool {
    headers.get("rsc-action-id").is_some()
}

pub async fn handle_server_action(
    State(state): State<ServerState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, StatusCode> {
    handle_server_action_at_path(state, "/_rari/action".to_string(), headers, body).await
}

pub async fn handle_page_server_action(
    State(state): State<ServerState>,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, StatusCode> {
    if !is_server_action_request(&headers) {
        return Err(StatusCode::METHOD_NOT_ALLOWED);
    }

    handle_server_action_at_path(state, uri.path().to_string(), headers, body).await
}

async fn handle_server_action_at_path(
    state: ServerState,
    request_path: String,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, StatusCode> {
    let allowed_origins = state.config.action_origins();
    if let Err(e) = check_origin(&headers, &allowed_origins) {
        return Ok(rpc_action_error_response(&e, state.config.is_development(), None));
    }

    let action_id = headers
        .get("rsc-action-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty());

    let request_context =
        Arc::new(RequestContext::new(request_path).with_http_headers(extract_headers(&headers)));

    if let Some(action_id) = action_id {
        let export_name = action_export_name(action_id);
        if is_reserved_export_name(export_name) {
            tracing::error!("Attempted to call reserved export name: {}", export_name);
            return Ok(rpc_action_error_response(
                &RariError::bad_request(format!(
                    "Invalid export name '{export_name}': reserved for internal use"
                )),
                state.config.is_development(),
                Some(&request_context.pending_cookies),
            ));
        }
    }

    let runtime = {
        let renderer = state.renderer.lock().await;
        Arc::clone(&renderer.runtime)
    };

    Ok(handle_solid_server_action(&state, &runtime, &request_context, action_id, &body).await)
}

const SOLID_ACTION_CONTENT_TYPE: &str = "application/x-rari-seroval";

async fn handle_solid_server_action(
    state: &ServerState,
    runtime: &Arc<JsExecutionRuntime>,
    request_context: &Arc<RequestContext>,
    action_id: Option<&str>,
    body: &Bytes,
) -> Response {
    let is_development = state.config.is_development();
    let pending = Some(&*request_context.pending_cookies);

    let Some(action_id) = action_id else {
        return rpc_action_error_response(
            &RariError::bad_request("Solid server actions require the rsc-action-id header"),
            is_development,
            pending,
        );
    };
    let Ok(args_expr) = str::from_utf8(body) else {
        return rpc_action_error_response(
            &RariError::bad_request("Action payload must be valid UTF-8"),
            is_development,
            pending,
        );
    };

    // Broadcast loads need every pool slot, so the pipeline must exist before any slot is leased.
    if let Err(e) = run_with_renderer_result(Arc::clone(&state.renderer), |renderer| async move {
        renderer.ensure_solid_actions_pipeline().await
    })
    .await
    {
        tracing::error!("Failed to prepare Solid action pipeline: {}", e);
        return rpc_action_error_response(&e, is_development, pending);
    }

    let leased = match runtime.acquire_request_runtime(Arc::clone(request_context)).await {
        Ok(leased) => leased,
        Err(e) => {
            tracing::error!("Failed to acquire JS runtime for server action: {}", e);
            return rpc_action_error_response(&e, is_development, pending);
        }
    };

    let outcome = match solid_action_script(action_id, args_expr) {
        Ok(script) => leased
            .execute_script("solid_action_dispatch".to_string(), script)
            .await
            .and_then(|value| parse_solid_action_outcome(&value)),
        Err(e) => Err(e),
    };
    if let Err(e) = leased.release().await {
        tracing::error!("Failed to release action runtime lease: {}", e);
    }

    let outcome = match outcome {
        Ok(outcome) => outcome,
        Err(e) => {
            tracing::error!("Solid server action execution failed: {}", e);
            return rpc_action_error_response(&e, is_development, pending);
        }
    };

    let redirect_config = state.config.redirect_config();
    let redirect = outcome
        .redirect
        .as_deref()
        .and_then(|url| validate_redirect_url(url, &redirect_config).ok());
    if let Some(ref redirect_url) = redirect {
        invalidate_redirect_target_caches(state, redirect_url, None).await;
    }

    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, SOLID_ACTION_CONTENT_TYPE)
        .header(header::CACHE_CONTROL, "no-store, no-cache, must-revalidate, private");
    if let Some(redirect_url) = redirect {
        builder = builder.header("x-action-redirect", format!("{redirect_url};push"));
    }
    #[expect(clippy::expect_used, reason = "Response::builder() with valid components never fails")]
    let mut response = builder.body(Body::from(outcome.body)).expect("Valid action response");
    append_pending_cookies(response.headers_mut(), &request_context.pending_cookies);
    response
}

pub fn validate_redirect_url(url: &str, config: &RedirectConfig) -> Result<String, RariError> {
    if config.allow_relative && url.starts_with('/') && !url.starts_with("//") {
        return Ok(url.to_string());
    }

    let parsed =
        url::Url::parse(url).map_err(|_| RariError::bad_request("Invalid redirect URL format"))?;

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(RariError::bad_request("Invalid redirect scheme: only http/https allowed"));
    }

    if let Some(host) = parsed.host_str() {
        let is_allowed = config.allowed_hosts.iter().any(|allowed| {
            if config.allow_subdomains {
                host == allowed || host.ends_with(&format!(".{allowed}"))
            } else {
                host == allowed
            }
        });

        if !is_allowed {
            return Err(RariError::bad_request("Redirect to untrusted host not allowed"));
        }
    } else {
        return Err(RariError::bad_request("Invalid redirect URL: missing host"));
    }

    Ok(url.to_string())
}

pub fn is_reserved_export_name(name: &str) -> bool {
    matches!(
        name,
        "then"
            | "catch"
            | "finally"
            | "toString"
            | "valueOf"
            | "toLocaleString"
            | "constructor"
            | "Symbol"
            | "@@iterator"
            | "@@toStringTag"
    )
}

fn append_pending_cookies(
    headers: &mut HeaderMap,
    pending_cookies: &dashmap::DashMap<PendingCookieKey, PendingCookie>,
) {
    for entry in pending_cookies {
        let cookie = entry.value();
        match build_set_cookie_header(cookie) {
            Ok(set_cookie_value) => match set_cookie_value.parse() {
                Ok(header_value) => {
                    headers.append(header::SET_COOKIE, header_value);
                }
                Err(_) => {
                    tracing::warn!(
                        "Failed to parse Set-Cookie header for '{}': invalid header value",
                        cookie.name
                    );
                }
            },
            Err(e) => {
                tracing::warn!("Skipped invalid cookie '{}': {}", cookie.name, e);
            }
        }
    }
}

pub fn is_valid_cookie_name(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b > 32 && b < 127 && !b"()<>@,;:\\\"/[]?={} \t".contains(&b))
}

pub fn is_valid_cookie_value(s: &str) -> bool {
    s.bytes().all(|b| matches!(b, 0x21 | 0x23..=0x2B | 0x2D..=0x3A | 0x3C..=0x5B | 0x5D..=0x7E))
}

pub fn is_valid_attr_value(s: &str) -> bool {
    !s.is_empty() && s.is_ascii() && s.bytes().all(|b| b >= 32 && b != b';' && b != 127)
}

pub fn build_set_cookie_header(cookie: &PendingCookie) -> Result<String, RariError> {
    if !is_valid_cookie_name(&cookie.name) {
        return Err(RariError::validation(format!("invalid cookie name: {}", cookie.name)));
    }
    if !is_valid_cookie_value(&cookie.value) {
        return Err(RariError::validation(format!("invalid cookie value for: {}", cookie.name)));
    }

    let path = cookie.path.as_deref().unwrap_or("/");
    if !is_valid_attr_value(path) {
        return Err(RariError::validation(format!("invalid cookie path: {path}")));
    }

    let mut header = format!("{}={}", cookie.name, cookie.value);
    #[expect(clippy::unwrap_used, reason = "write! to String never fails")]
    write!(&mut header, "; Path={path}").unwrap();

    if let Some(domain) = &cookie.domain {
        if !is_valid_attr_value(domain) {
            return Err(RariError::validation(format!("invalid cookie domain: {domain}")));
        }
        #[expect(clippy::unwrap_used, reason = "write! to String never fails")]
        write!(&mut header, "; Domain={domain}").unwrap();
    }
    if let Some(expires) = &cookie.expires {
        if !is_valid_attr_value(expires) {
            return Err(RariError::validation(format!("invalid cookie expires: {expires}")));
        }
        #[expect(clippy::unwrap_used, reason = "write! to String never fails")]
        write!(&mut header, "; Expires={expires}").unwrap();
    }
    if let Some(max_age) = cookie.max_age {
        #[expect(clippy::unwrap_used, reason = "write! to String never fails")]
        write!(&mut header, "; Max-Age={max_age}").unwrap();
    }
    let normalized_same_site =
        cookie.same_site.as_deref().map(cow_utils::CowUtils::cow_to_ascii_lowercase);
    if normalized_same_site.as_deref() == Some("none") && !cookie.secure {
        return Err(RariError::validation("SameSite=None requires Secure"));
    }
    if cookie.partitioned && !cookie.secure {
        return Err(RariError::validation("Partitioned requires Secure"));
    }
    if cookie.http_only {
        header.push_str("; HttpOnly");
    }
    if cookie.secure {
        header.push_str("; Secure");
    }
    if let Some(same_site) = normalized_same_site.as_deref() {
        let serialized_same_site = match same_site {
            "strict" => "Strict",
            "lax" => "Lax",
            "none" => "None",
            _ => {
                return Err(RariError::validation(format!("invalid SameSite value: {same_site}")));
            }
        };
        #[expect(clippy::unwrap_used, reason = "write! to String never fails")]
        write!(&mut header, "; SameSite={serialized_same_site}").unwrap();
    }
    if let Some(priority) = &cookie.priority {
        match priority.cow_to_ascii_lowercase().as_ref() {
            "low" => header.push_str("; Priority=Low"),
            "medium" => header.push_str("; Priority=Medium"),
            "high" => header.push_str("; Priority=High"),
            _ => {
                return Err(RariError::validation(format!("invalid Priority value: {priority}")));
            }
        }
    }
    if cookie.partitioned {
        header.push_str("; Partitioned");
    }
    Ok(header)
}

#[cfg(test)]
#[expect(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::server::{config::RedirectConfig, middleware::request_context::PendingCookie};

    #[test]
    fn test_redirect_relative_url_allowed() {
        let config =
            RedirectConfig { allowed_hosts: vec![], allow_relative: true, allow_subdomains: false };

        assert!(validate_redirect_url("/dashboard", &config).is_ok());
        assert!(validate_redirect_url("/users/123", &config).is_ok());
        assert!(validate_redirect_url("/", &config).is_ok());
    }

    #[test]
    fn test_redirect_relative_url_blocked_when_disabled() {
        let config = RedirectConfig {
            allowed_hosts: vec![],
            allow_relative: false,
            allow_subdomains: false,
        };

        assert!(validate_redirect_url("/dashboard", &config).is_err());
    }

    #[test]
    fn test_redirect_protocol_relative_blocked() {
        let config =
            RedirectConfig { allowed_hosts: vec![], allow_relative: true, allow_subdomains: false };

        assert!(validate_redirect_url("//evil.com/phishing", &config).is_err());
    }

    #[test]
    fn test_redirect_allowed_host() {
        let config = RedirectConfig {
            allowed_hosts: vec!["example.com".to_string()],
            allow_relative: true,
            allow_subdomains: false,
        };

        assert!(validate_redirect_url("https://example.com/page", &config).is_ok());
        assert!(validate_redirect_url("http://example.com/page", &config).is_ok());
    }

    #[test]
    fn test_redirect_blocked_host() {
        let config = RedirectConfig {
            allowed_hosts: vec!["example.com".to_string()],
            allow_relative: true,
            allow_subdomains: false,
        };

        assert!(validate_redirect_url("https://evil.com/phishing", &config).is_err());
        assert!(validate_redirect_url("https://attacker.com", &config).is_err());
    }

    #[test]
    fn test_redirect_subdomain_when_allowed() {
        let config = RedirectConfig {
            allowed_hosts: vec!["example.com".to_string()],
            allow_relative: true,
            allow_subdomains: true,
        };

        assert!(validate_redirect_url("https://example.com/page", &config).is_ok());
        assert!(validate_redirect_url("https://www.example.com/page", &config).is_ok());
        assert!(validate_redirect_url("https://api.example.com/page", &config).is_ok());
        assert!(validate_redirect_url("https://sub.domain.example.com/page", &config).is_ok());
    }

    #[test]
    fn test_redirect_subdomain_when_blocked() {
        let config = RedirectConfig {
            allowed_hosts: vec!["example.com".to_string()],
            allow_relative: true,
            allow_subdomains: false,
        };

        assert!(validate_redirect_url("https://example.com/page", &config).is_ok());
        assert!(validate_redirect_url("https://www.example.com/page", &config).is_err());
        assert!(validate_redirect_url("https://api.example.com/page", &config).is_err());
    }

    #[test]
    fn test_redirect_invalid_scheme() {
        let config = RedirectConfig {
            allowed_hosts: vec!["example.com".to_string()],
            allow_relative: true,
            allow_subdomains: false,
        };

        assert!(validate_redirect_url("javascript:alert(1)", &config).is_err());
        assert!(
            validate_redirect_url("data:text/html,<script>alert(1)</script>", &config).is_err()
        );
        assert!(validate_redirect_url("ftp://example.com/file", &config).is_err());
        assert!(validate_redirect_url("file:///etc/passwd", &config).is_err());
    }

    #[test]
    fn test_redirect_multiple_allowed_hosts() {
        let config = RedirectConfig {
            allowed_hosts: vec![
                "example.com".to_string(),
                "trusted.com".to_string(),
                "localhost".to_string(),
            ],
            allow_relative: true,
            allow_subdomains: false,
        };

        assert!(validate_redirect_url("https://example.com/page", &config).is_ok());
        assert!(validate_redirect_url("https://trusted.com/page", &config).is_ok());
        assert!(validate_redirect_url("http://localhost:3000/page", &config).is_ok());
        assert!(validate_redirect_url("https://evil.com/page", &config).is_err());
    }

    #[test]
    fn test_redirect_invalid_url_format() {
        let config = RedirectConfig {
            allowed_hosts: vec!["example.com".to_string()],
            allow_relative: true,
            allow_subdomains: false,
        };

        assert!(validate_redirect_url("not a url", &config).is_err());
        assert!(validate_redirect_url("ht!tp://example.com", &config).is_err());
    }

    #[test]
    fn test_redirect_with_port() {
        let config = RedirectConfig {
            allowed_hosts: vec!["localhost".to_string(), "example.com".to_string()],
            allow_relative: true,
            allow_subdomains: false,
        };

        assert!(validate_redirect_url("http://localhost:3000/page", &config).is_ok());
        assert!(validate_redirect_url("https://example.com:8443/page", &config).is_ok());
    }

    #[test]
    fn test_redirect_with_query_and_fragment() {
        let config = RedirectConfig {
            allowed_hosts: vec!["example.com".to_string()],
            allow_relative: true,
            allow_subdomains: false,
        };

        assert!(validate_redirect_url("https://example.com/page?foo=bar", &config).is_ok());
        assert!(validate_redirect_url("https://example.com/page#section", &config).is_ok());
        assert!(validate_redirect_url("https://example.com/page?foo=bar#section", &config).is_ok());
        assert!(validate_redirect_url("/page?foo=bar#section", &config).is_ok());
    }

    #[test]
    fn test_redirect_empty_allowed_hosts() {
        let config =
            RedirectConfig { allowed_hosts: vec![], allow_relative: true, allow_subdomains: false };

        assert!(validate_redirect_url("/page", &config).is_ok());

        assert!(validate_redirect_url("https://example.com/page", &config).is_err());
    }

    #[test]
    fn test_redirect_case_sensitivity() {
        let config = RedirectConfig {
            allowed_hosts: vec!["example.com".to_string()],
            allow_relative: true,
            allow_subdomains: false,
        };

        assert!(validate_redirect_url("https://example.com/page", &config).is_ok());
        assert!(validate_redirect_url("https://EXAMPLE.COM/page", &config).is_ok());
        assert!(validate_redirect_url("https://Example.Com/page", &config).is_ok());

        assert!(validate_redirect_url("https://evil.com/page", &config).is_err());
    }

    #[test]
    fn test_redirect_homograph_attack_prevention() {
        let config = RedirectConfig {
            allowed_hosts: vec!["example.com".to_string()],
            allow_relative: true,
            allow_subdomains: false,
        };

        assert!(validate_redirect_url("https://examp1e.com/page", &config).is_err());
        assert!(validate_redirect_url("https://example.co/page", &config).is_err());
        assert!(validate_redirect_url("https://examplecom.com/page", &config).is_err());
    }

    #[test]
    fn test_is_reserved_export_name_then() {
        use super::is_reserved_export_name;

        assert!(is_reserved_export_name("then"));
        assert!(is_reserved_export_name("catch"));
        assert!(is_reserved_export_name("finally"));
    }

    #[test]
    fn test_is_reserved_export_name_object_methods() {
        use super::is_reserved_export_name;

        assert!(is_reserved_export_name("toString"));
        assert!(is_reserved_export_name("valueOf"));
        assert!(is_reserved_export_name("toLocaleString"));
        assert!(is_reserved_export_name("constructor"));
    }

    #[test]
    fn test_is_reserved_export_name_symbols() {
        use super::is_reserved_export_name;

        assert!(is_reserved_export_name("Symbol"));
        assert!(is_reserved_export_name("@@iterator"));
        assert!(is_reserved_export_name("@@toStringTag"));
    }

    #[test]
    fn test_is_reserved_export_name_allows_valid_names() {
        use super::is_reserved_export_name;

        assert!(!is_reserved_export_name("getData"));
        assert!(!is_reserved_export_name("submitForm"));
        assert!(!is_reserved_export_name("updateUser"));
        assert!(!is_reserved_export_name("deleteItem"));
        assert!(!is_reserved_export_name("GET"));
        assert!(!is_reserved_export_name("POST"));
        assert!(!is_reserved_export_name("myAction"));
    }

    #[test]
    fn test_is_reserved_export_name_case_sensitive() {
        use super::is_reserved_export_name;

        assert!(is_reserved_export_name("then"));
        assert!(!is_reserved_export_name("Then"));
        assert!(!is_reserved_export_name("THEN"));

        assert!(is_reserved_export_name("catch"));
        assert!(!is_reserved_export_name("Catch"));
    }

    #[test]
    fn test_is_reserved_export_name_similar_names() {
        use super::is_reserved_export_name;

        assert!(!is_reserved_export_name("thenDo"));
        assert!(!is_reserved_export_name("catchError"));
        assert!(!is_reserved_export_name("finallyDone"));
        assert!(!is_reserved_export_name("myThen"));
    }

    #[test]
    fn test_cookie_value_rejects_double_quote() {
        let cookie = PendingCookie {
            name: "session".to_string(),
            value: "value\"with\"quotes".to_string(),
            path: Some("/".to_string()),
            domain: None,
            max_age: None,
            expires: None,
            secure: false,
            http_only: false,
            same_site: None,
            priority: None,
            partitioned: false,
        };

        let result = super::build_set_cookie_header(&cookie);
        assert!(result.is_err(), "Cookie value with double-quote should be rejected");
    }

    #[test]
    fn test_cookie_value_rejects_backslash() {
        let cookie = PendingCookie {
            name: "session".to_string(),
            value: "value\\with\\backslash".to_string(),
            path: Some("/".to_string()),
            domain: None,
            max_age: None,
            expires: None,
            secure: false,
            http_only: false,
            same_site: None,
            priority: None,
            partitioned: false,
        };

        let result = super::build_set_cookie_header(&cookie);
        assert!(result.is_err(), "Cookie value with backslash should be rejected");
    }

    #[test]
    fn test_response_cache_cookie_partition_ignores_unrelated_cookies() {
        let unrelated = super::response_cache_cookie_partition(Some("session=abc; _ga=1"));
        assert_eq!(unrelated, None);

        let encoded = BASE64_STANDARD.encode(r#"{"ok":true}"#);
        let with_form_state = super::response_cache_cookie_partition(Some(&format!(
            "session=abc; rari-action-form-state={encoded}"
        )));
        assert_eq!(with_form_state, Some(format!("rari-action-form-state={encoded}")));
    }

    #[test]
    fn test_action_form_state_cookie_base64_roundtrip() {
        let form_state = serde_json::json!({ "message": "Todo added \"successfully\"" });
        let encoded = super::encode_action_form_state_cookie_value(&form_state).expect("encoded");
        assert!(!encoded.contains('"'));

        let decoded = super::decode_action_form_state_cookie_value(&encoded).expect("decoded");
        assert_eq!(decoded, form_state);
    }

    #[test]
    fn test_cookie_value_rejects_space() {
        let cookie = PendingCookie {
            name: "session".to_string(),
            value: "value with spaces".to_string(),
            path: Some("/".to_string()),
            domain: None,
            max_age: None,
            expires: None,
            secure: false,
            http_only: false,
            same_site: None,
            priority: None,
            partitioned: false,
        };

        let result = super::build_set_cookie_header(&cookie);
        assert!(result.is_err(), "Cookie value with space should be rejected");
    }

    #[test]
    fn test_cookie_value_accepts_valid_characters() {
        let cookie = PendingCookie {
            name: "session".to_string(),
            value: "abc123-_~!#$%&'()*+./:<=>?@[]^`{|}".to_string(),
            path: Some("/".to_string()),
            domain: None,
            max_age: None,
            expires: None,
            secure: false,
            http_only: false,
            same_site: None,
            priority: None,
            partitioned: false,
        };

        let result = super::build_set_cookie_header(&cookie);
        assert!(result.is_ok(), "Cookie value with valid RFC 6265 characters should be accepted");
    }

    #[test]
    fn test_cookie_value_rejects_control_characters() {
        let cookie = PendingCookie {
            name: "session".to_string(),
            value: "value\x00with\x1Fcontrol".to_string(),
            path: Some("/".to_string()),
            domain: None,
            max_age: None,
            expires: None,
            secure: false,
            http_only: false,
            same_site: None,
            priority: None,
            partitioned: false,
        };

        let result = super::build_set_cookie_header(&cookie);
        assert!(result.is_err(), "Cookie value with control characters should be rejected");
    }

    #[test]
    fn test_cookie_value_rejects_del_character() {
        let cookie = PendingCookie {
            name: "session".to_string(),
            value: "value\x7Fwith_del".to_string(),
            path: Some("/".to_string()),
            domain: None,
            max_age: None,
            expires: None,
            secure: false,
            http_only: false,
            same_site: None,
            priority: None,
            partitioned: false,
        };

        let result = super::build_set_cookie_header(&cookie);
        assert!(result.is_err(), "Cookie value with DEL character (0x7F) should be rejected");
    }

    #[test]
    fn test_cookie_value_accepts_exclamation_mark() {
        let cookie = PendingCookie {
            name: "session".to_string(),
            value: "value!".to_string(),
            path: Some("/".to_string()),
            domain: None,
            max_age: None,
            expires: None,
            secure: false,
            http_only: false,
            same_site: None,
            priority: None,
            partitioned: false,
        };

        let result = super::build_set_cookie_header(&cookie);
        assert!(result.is_ok(), "Cookie value with exclamation mark (0x21) should be accepted");
    }

    #[test]
    fn test_origin_comparison_with_default_https_port() {
        use axum::http::HeaderMap;

        use super::check_origin;

        let mut headers = HeaderMap::new();
        headers.insert("host", "example.com".parse().unwrap());
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        headers.insert("origin", "https://example.com:443".parse().unwrap());

        let result = check_origin(&headers, &[]);
        assert!(
            result.is_ok(),
            "Origin with explicit default HTTPS port (443) should match server origin without port"
        );
    }

    #[test]
    fn test_origin_comparison_with_default_http_port() {
        use axum::http::HeaderMap;

        use super::check_origin;

        let mut headers = HeaderMap::new();
        headers.insert("host", "example.com".parse().unwrap());
        headers.insert("x-forwarded-proto", "http".parse().unwrap());
        headers.insert("origin", "http://example.com:80".parse().unwrap());

        let result = check_origin(&headers, &[]);
        assert!(
            result.is_ok(),
            "Origin with explicit default HTTP port (80) should match server origin without port"
        );
    }

    #[test]
    fn test_origin_comparison_with_explicit_port_in_host() {
        use axum::http::HeaderMap;

        use super::check_origin;

        let mut headers = HeaderMap::new();
        headers.insert("host", "example.com:8080".parse().unwrap());
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        headers.insert("origin", "https://example.com:8080".parse().unwrap());

        let result = check_origin(&headers, &[]);
        assert!(
            result.is_ok(),
            "Origin with explicit non-default port should match server origin with same port"
        );
    }

    #[test]
    fn test_origin_comparison_port_mismatch() {
        use axum::http::HeaderMap;

        use super::check_origin;

        let mut headers = HeaderMap::new();
        headers.insert("host", "example.com:8080".parse().unwrap());
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        headers.insert("origin", "https://example.com:9090".parse().unwrap());

        let result = check_origin(&headers, &[]);
        assert!(result.is_err(), "Origin with different port should not match");
    }

    #[test]
    fn test_referer_comparison_with_default_port() {
        use axum::http::HeaderMap;

        use super::check_origin;

        let mut headers = HeaderMap::new();
        headers.insert("host", "example.com".parse().unwrap());
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        headers.insert("referer", "https://example.com:443/some/path".parse().unwrap());

        let result = check_origin(&headers, &[]);
        assert!(
            result.is_ok(),
            "Referer with explicit default HTTPS port (443) should match server origin without port"
        );
    }

    #[test]
    fn test_configured_origin_still_allows_same_host() {
        use axum::http::HeaderMap;

        use super::check_origin;

        let mut headers = HeaderMap::new();
        headers.insert("host", "127.0.0.1:3000".parse().unwrap());
        headers.insert("origin", "http://127.0.0.1:3000".parse().unwrap());

        let result = check_origin(&headers, &["https://rari.build".to_string()]);
        assert!(
            result.is_ok(),
            "Local same-origin requests should be allowed even when a public origin is configured"
        );
    }

    #[test]
    fn test_configured_origin_rejects_cross_site() {
        use axum::http::HeaderMap;

        use super::check_origin;

        let mut headers = HeaderMap::new();
        headers.insert("host", "rari.build".parse().unwrap());
        headers.insert("x-forwarded-proto", "https".parse().unwrap());
        headers.insert("origin", "https://evil.example".parse().unwrap());

        let result = check_origin(&headers, &["https://rari.build".to_string()]);
        assert!(result.is_err(), "Cross-site origins must still be rejected");
    }
}
