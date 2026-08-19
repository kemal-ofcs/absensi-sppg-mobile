use reqwest::{
    header::{HeaderValue, COOKIE, ORIGIN, SET_COOKIE},
    Method, StatusCode,
};
use serde_json::{json, Value};
use zeroize::Zeroizing;

use super::{
    config::MobileState,
    models::{CommandError, LoginApiResponse, RemoteLogin},
};

pub enum RemoteLoginError {
    Rejected(CommandError),
    Unavailable,
}

fn endpoint(state: &MobileState, path: &str) -> Result<url::Url, CommandError> {
    state.api_base_url().join(path).map_err(|_| {
        CommandError::new(
            "MOBILE_CONFIG_INVALID",
            "Endpoint server Mobile tidak valid.",
        )
    })
}

fn session_cookie(headers: &reqwest::header::HeaderMap) -> Option<Zeroizing<String>> {
    headers.get_all(SET_COOKIE).iter().find_map(|header| {
        header.to_str().ok()?.split(';').find_map(|part| {
            part.trim()
                .strip_prefix("sppg_session=")
                .filter(|value| !value.is_empty())
                .map(|value| Zeroizing::new(value.to_owned()))
        })
    })
}

pub async fn login(
    state: &MobileState,
    identifier: &str,
    password: &str,
) -> Result<RemoteLogin, RemoteLoginError> {
    let url = endpoint(state, "/api/auth/login").map_err(RemoteLoginError::Rejected)?;
    let server_origin = state.server_origin();
    let response = state
        .http
        .post(url)
        .header(ORIGIN, server_origin.as_str())
        .json(&json!({ "username": identifier, "password": password }))
        .send()
        .await
        .map_err(|_| RemoteLoginError::Unavailable)?;
    let status = response.status();
    let token = session_cookie(response.headers());
    let body = response
        .json::<LoginApiResponse>()
        .await
        .map_err(|_| RemoteLoginError::Unavailable)?;

    if status.is_success() && body.sukses {
        let operator = body.operator.ok_or(RemoteLoginError::Unavailable)?;
        let token = token.ok_or(RemoteLoginError::Unavailable)?;
        return Ok(RemoteLogin {
            operator,
            token,
            message: body
                .pesan
                .unwrap_or_else(|| "Login online berhasil.".into()),
        });
    }

    if status.is_server_error() {
        return Err(RemoteLoginError::Unavailable);
    }
    let code = if status == StatusCode::TOO_MANY_REQUESTS {
        "LOGIN_RATE_LIMITED"
    } else {
        "LOGIN_REJECTED"
    };
    Err(RemoteLoginError::Rejected(CommandError::new(
        code,
        body.pesan
            .unwrap_or_else(|| "Username atau password tidak sesuai.".into()),
    )))
}

pub async fn authorized_json(
    state: &MobileState,
    method: Method,
    path: &str,
    body: Option<Value>,
    token: &str,
) -> Result<Value, CommandError> {
    let url = endpoint(state, path)?;
    let cookie = HeaderValue::from_str(&format!("sppg_session={token}"))
        .map_err(|_| CommandError::internal())?;
    let server_origin = state.server_origin();
    let mut request = state
        .http
        .request(method, url)
        .header(ORIGIN, server_origin.as_str())
        .header(COOKIE, cookie);

    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|_| {
        CommandError::new(
            "MOBILE_SERVER_UNAVAILABLE",
            "Server aplikasi tidak dapat dijangkau. Tindakan keamanan wajib online.",
        )
    })?;
    let status = response.status();
    let payload = response.json::<Value>().await.unwrap_or_else(|_| json!({}));
    if status.is_success() {
        return Ok(payload);
    }
    let fallback_message = match status {
        StatusCode::NOT_FOUND => {
            "Endpoint sinkronisasi tidak ditemukan pada server aplikasi. Pastikan Mobile terhubung ke versi server yang sama."
        }
        StatusCode::INTERNAL_SERVER_ERROR => {
            "Server aplikasi mengalami kesalahan saat memproses sinkronisasi (HTTP 500)."
        }
        _ => "Permintaan server tidak dapat diproses.",
    };
    let message = payload
        .get("pesan")
        .and_then(Value::as_str)
        .unwrap_or(fallback_message);
    let code = match status {
        StatusCode::UNAUTHORIZED => "MOBILE_SESSION_EXPIRED",
        StatusCode::FORBIDDEN => "MOBILE_ACCESS_DENIED",
        _ => "MOBILE_API_ERROR",
    };
    Err(CommandError::new(code, message))
}

pub async fn logout(state: &MobileState, token: &str) {
    let _ = authorized_json(state, Method::DELETE, "/api/auth/session", None, token).await;
}

#[cfg(test)]
mod tests {
    use reqwest::header::{HeaderMap, HeaderValue, SET_COOKIE};

    use super::session_cookie;

    #[test]
    fn extracts_only_the_session_cookie() {
        let mut headers = HeaderMap::new();
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("theme=dark; Path=/; SameSite=Lax"),
        );
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static(
                "sppg_session=header.payload.signature; Path=/; HttpOnly; Secure",
            ),
        );

        assert_eq!(
            session_cookie(&headers).as_deref().map(String::as_str),
            Some("header.payload.signature")
        );
    }

    #[test]
    fn rejects_an_empty_session_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(
            SET_COOKIE,
            HeaderValue::from_static("sppg_session=; Path=/; HttpOnly"),
        );
        assert!(session_cookie(&headers).is_none());
    }
}
