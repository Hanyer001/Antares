//! Entrada HTTP local para WebKitGTK y WKWebView.
//! Mismos hosts permitidos y CORS; transmite completo el rango pedido.
//! No acumula el archivo en RAM ni presenta un trozo como final del medio.

use std::convert::Infallible;
use std::net::TcpListener;
use std::time::Duration;

use futures_util::stream;
use http_body_util::{combinators::UnsyncBoxBody, BodyExt, Full};
use hyper::body::{Bytes, Frame};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::{TokioIo, TokioTimer};
use tauri::http::{header, Method, Request, Response, StatusCode};

use crate::audio_proxy;

pub struct LocalAudio {
    pub base: String,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl LocalAudio {
    pub fn start() -> std::io::Result<Self> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let host = listener.local_addr()?.to_string();
        let token = uuid::Uuid::new_v4().simple().to_string();
        let base = format!("http://{host}/{token}");
        let task = tauri::async_runtime::spawn(async move {
            let listener = match tokio::net::TcpListener::from_std(listener) {
                Ok(listener) => listener,
                Err(e) => {
                    eprintln!("No se pudo iniciar el audio local: {e}");
                    return;
                }
            };
            while let Ok((stream, _)) = listener.accept().await {
                let host = host.clone();
                let token = token.clone();
                tauri::async_runtime::spawn(async move {
                    let service = service_fn(move |request: Request<hyper::body::Incoming>| {
                        let host = host.clone();
                        let token = token.clone();
                        async move {
                            let response =
                                respond(request.map(|_| Vec::new()), &host, &token).await;
                            Ok::<_, Infallible>(response)
                        }
                    });
                    // Limitar las cabeceras, no la duración del audio. La contrapresión
                    // de Hyper y chunk() mantienen acotada la memoria de cada conexión.
                    let mut http = http1::Builder::new();
                    http.keep_alive(false)
                        .max_buf_size(16 * 1024)
                        .timer(TokioTimer::new())
                        .header_read_timeout(Duration::from_secs(10));
                    let _ = http.serve_connection(TokioIo::new(stream), service).await;
                });
            }
        });
        Ok(Self { base, task })
    }
}

impl Drop for LocalAudio {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn forward_request(
    mut request: Request<Vec<u8>>,
    host: &str,
    token: &str,
) -> Result<Request<Vec<u8>>, Response<Vec<u8>>> {
    let reject = || audio_proxy::error(StatusCode::FORBIDDEN, "audio local no autorizado");
    if request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        != Some(host)
        || request.uri().query().is_some()
    {
        return Err(reject());
    }
    let Some((key, path)) = request
        .uri()
        .path()
        .strip_prefix('/')
        .and_then(|p| p.split_once('/'))
    else {
        return Err(reject());
    };
    if key != token || path.is_empty() {
        return Err(reject());
    }
    let uri = format!("stream://localhost/{path}")
        .parse()
        .map_err(|_| reject())?;
    *request.uri_mut() = uri;
    Ok(request)
}

type AudioBody = UnsyncBoxBody<Bytes, reqwest::Error>;

fn buffered(response: Response<Vec<u8>>) -> Response<AudioBody> {
    response.map(|body| {
        Full::new(Bytes::from(body))
            .map_err(|never| match never {})
            .boxed_unsync()
    })
}

async fn respond(request: Request<Vec<u8>>, host: &str, token: &str) -> Response<AudioBody> {
    let request = match forward_request(request, host, token) {
        Ok(request) => request,
        Err(response) => return buffered(response),
    };
    if request.method() == Method::OPTIONS {
        return buffered(
            Response::builder()
                .status(StatusCode::NO_CONTENT)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
                .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
                .body(Vec::new())
                .unwrap(),
        );
    }
    if request.method() != Method::HEAD && request.method() != Method::GET {
        return buffered(audio_proxy::error(
            StatusCode::METHOD_NOT_ALLOWED,
            "metodo no admitido",
        ));
    }
    let Some(target) = audio_proxy::target_url(request.uri().path()) else {
        return buffered(audio_proxy::error(
            StatusCode::FORBIDDEN,
            "solo audio de googlevideo",
        ));
    };
    let started = std::time::Instant::now();
    let upstream = match audio_proxy::fetch(
        &target,
        request.method().clone(),
        request.headers().get(header::RANGE).cloned(),
    )
    .await
    {
        Ok(upstream) => upstream,
        Err(error) => {
            eprintln!("Audio local: {error}");
            return buffered(audio_proxy::error(
                StatusCode::BAD_GATEWAY,
                "no se pudo pedir el audio",
            ));
        }
    };
    let range = request.headers().get(header::RANGE).and_then(|value| value.to_str().ok());
    let timing = (audio_proxy::parse_range(range).0 == 0).then_some(started);
    relay_timed(upstream, request.method() == Method::HEAD, timing)
}

/// Conservar el contrato HTTP del origen. Recortar una respuesta bytes=0- a
/// 1 MiB hacía que GStreamer aceptase la duración completa pero llegase a EOS
/// al agotar ese trozo, también al buscar una posición posterior.
#[cfg(test)]
fn relay(upstream: reqwest::Response, head: bool) -> Response<AudioBody> {
    relay_timed(upstream, head, None)
}

fn relay_timed(upstream: reqwest::Response, head: bool, timing: Option<std::time::Instant>) -> Response<AudioBody> {
    let mut response = Response::builder()
        .status(upstream.status())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Content-Length, Accept-Ranges",
        )
        .header(header::CACHE_CONTROL, "no-store")
        .header("Timing-Allow-Origin", "*");
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CONTENT_RANGE,
        header::ACCEPT_RANGES,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            response = response.header(name, value);
        }
    }
    if head {
        return response
            .body(
                Full::new(Bytes::new())
                    .map_err(|never| match never {})
                    .boxed_unsync(),
            )
            .unwrap();
    }
    let timing = timing.filter(|_| upstream.status().is_success());
    let chunks = stream::try_unfold((upstream, timing), |(mut upstream, timing)| async move {
        match upstream.chunk().await? {
            Some(bytes) => {
                if let Some(started) = timing { crate::diagnostics::first_byte(started.elapsed()); }
                Ok(Some((Frame::data(bytes), (upstream, None))))
            }
            None => Ok(None),
        }
    });
    response
        .body(http_body_util::StreamBody::new(chunks).boxed_unsync())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwards_encoded_audio_and_byte_range_without_changing_them() {
        let encoded = "https%3A%2F%2Frr1.googlevideo.com%2Fvideoplayback%3Fsig%3Da%252Bb";
        let request = Request::builder()
            .uri(format!("/secret/{encoded}"))
            .header(header::HOST, "127.0.0.1:12345")
            .header(header::RANGE, "bytes=100-199")
            .body(Vec::new())
            .unwrap();
        let request = forward_request(request, "127.0.0.1:12345", "secret").unwrap();
        assert_eq!(request.headers()[header::RANGE], "bytes=100-199");
        assert_eq!(
            audio_proxy::target_url(request.uri().path()).as_deref(),
            Some("https://rr1.googlevideo.com/videoplayback?sig=a%2Bb")
        );
    }

    #[tokio::test]
    async fn loopback_rejects_wrong_keys_hosts_and_targets_and_accepts_preflight() {
        let server = LocalAudio::start().unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let url = reqwest::Url::parse(&server.base).unwrap();
        assert_eq!(url.host_str(), Some("127.0.0.1"));
        let origin = format!("http://127.0.0.1:{}", url.port().unwrap());
        assert_eq!(
            client
                .get(format!("{origin}/wrong/probe"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            client
                .get(format!("{}/probe", server.base))
                .header(header::HOST, "evil.test")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            client
                .get(format!("{}/https%3A%2F%2Fevil.test%2Faudio", server.base))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            client
                .post(format!("{}/probe", server.base))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
        let response = client
            .request(Method::OPTIONS, format!("{}/probe", server.base))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
        assert_eq!(
            response.headers()[header::ACCESS_CONTROL_ALLOW_HEADERS],
            "Range"
        );
    }

    // Un origen local controlado permite probar el transporte sin depender
    // de YouTube ni de enlaces firmados que caducan.
    async fn media_fixture(range: Option<&str>, head: bool) -> Response<AudioBody> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let service = service_fn(|request: Request<hyper::body::Incoming>| async move {
                let total = 3 * 1024 * 1024 + 123;
                let range = request
                    .headers()
                    .get(header::RANGE)
                    .and_then(|v| v.to_str().ok());
                let (start, end) = audio_proxy::parse_range(range);
                let end = end.unwrap_or(total - 1).min(total - 1);
                let length = end - start + 1;
                let bytes = if request.method() == Method::HEAD {
                    vec![]
                } else {
                    (start..=end).map(|n| (n % 251) as u8).collect()
                };
                let mut response = Response::builder()
                    .status(if range.is_some() {
                        StatusCode::PARTIAL_CONTENT
                    } else {
                        StatusCode::OK
                    })
                    .header(header::CONTENT_TYPE, "audio/webm")
                    .header(header::CONTENT_LENGTH, length)
                    .header(header::ACCEPT_RANGES, "bytes");
                if range.is_some() {
                    response = response.header(
                        header::CONTENT_RANGE,
                        format!("bytes {start}-{end}/{total}"),
                    );
                }
                Ok::<_, Infallible>(response.body(Full::new(Bytes::from(bytes))).unwrap())
            });
            http1::Builder::new()
                .serve_connection(TokioIo::new(stream), service)
                .await
                .unwrap();
        });
        let upstream = audio_proxy::fetch(
            &format!("http://{address}/media"),
            if head { Method::HEAD } else { Method::GET },
            range.map(|r| r.parse().unwrap()),
        )
        .await
        .unwrap();
        relay(upstream, head)
    }

    #[tokio::test]
    async fn complete_media_and_open_ranges_reach_beyond_the_old_one_mib_cutoff() {
        let total = 3 * 1024 * 1024 + 123;
        for range in [
            None,
            Some("bytes=0-"),
            Some("bytes=1048576-"),
            Some("bytes=2000000-2000999"),
        ] {
            let response = media_fixture(range, false).await;
            assert_eq!(
                response.status(),
                if range.is_some() {
                    StatusCode::PARTIAL_CONTENT
                } else {
                    StatusCode::OK
                }
            );
            let (start, end) = audio_proxy::parse_range(range);
            let end = end.unwrap_or(total - 1);
            assert_eq!(
                response.headers()[header::CONTENT_LENGTH],
                (end - start + 1).to_string()
            );
            let body = response.into_body().collect().await.unwrap().to_bytes();
            assert_eq!(body.len() as u64, end - start + 1);
            assert!(body
                .iter()
                .enumerate()
                .all(|(i, byte)| *byte == ((start + i as u64) % 251) as u8));
        }
        let response = media_fixture(None, true).await;
        assert_eq!(
            response.headers()[header::CONTENT_LENGTH],
            total.to_string()
        );
        assert!(response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .is_empty());
    }

    #[tokio::test]
    async fn first_audio_bytes_arrive_before_the_upstream_finishes() {
        use tokio::io::AsyncWriteExt;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (continue_tx, continue_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            // Dar tiempo a leer la petición evita cerrar con datos sin consumir.
            use tokio::io::AsyncReadExt;
            let mut request = [0; 4096];
            let _ = stream.read(&mut request).await.unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 2097152\r\nConnection: close\r\n\r\n",
                )
                .await
                .unwrap();
            stream.write_all(&vec![1; 16384]).await.unwrap();
            continue_rx.await.unwrap();
            stream.write_all(&vec![2; 2097152 - 16384]).await.unwrap();
        });
        let upstream = audio_proxy::fetch(&format!("http://{address}/media"), Method::GET, None)
            .await
            .unwrap();
        let mut body = relay(upstream, false).into_body();
        let first = tokio::time::timeout(Duration::from_secs(2), body.frame())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .into_data()
            .unwrap();
        assert!(!first.is_empty());
        assert!(first.len() <= 16384);
        continue_tx.send(()).unwrap();
        let rest = body.collect().await.unwrap().to_bytes();
        assert_eq!(first.len() + rest.len(), 2097152);
    }
}
