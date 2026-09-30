//! Proxy stream:// para procesar audio de googlevideo con Web Audio.
//! Añade las cabeceras CORS y limita cada respuesta a CHUNK_BYTES.
//! Solo admite URLs de googlevideo y conserva el soporte de rangos HTTP.

use std::sync::OnceLock;
use std::time::Duration;

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};

/// 1 MiB: unos 60 s de audio a 128 kbps. Suficiente para que el primer trozo
/// arranque la cancion y pequeno para que llegue en milisegundos.
const CHUNK_BYTES: u64 = 1 << 20;

const ALLOWED_HOST_SUFFIX: &str = ".googlevideo.com";

/// Un solo cliente para toda la app: reutiliza la conexion con googlevideo
/// entre trozos, que es lo que hace que pedir por partes no salga caro.
fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_default()
    })
}

/// La URL de googlevideo que va codificada en la ruta, o `None` si no lo es.
pub fn target_url(path: &str) -> Option<String> {
    let encoded = path.trim_start_matches('/');
    let url = percent_decode_str(encoded).decode_utf8().ok()?.into_owned();

    let host = url.strip_prefix("https://")?.split(['/', '?']).next()?;
    host.ends_with(ALLOWED_HOST_SUFFIX).then_some(url)
}

/// `bytes=INICIO-FIN` → (inicio, fin opcional). Sin cabecera o ilegible,
/// desde el principio.
pub fn parse_range(value: Option<&str>) -> (u64, Option<u64>) {
    let Some(spec) = value.and_then(|v| v.trim().strip_prefix("bytes=")) else {
        return (0, None);
    };

    let mut parts = spec.splitn(2, '-');
    let start = parts.next().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
    let end = parts.next().and_then(|s| s.trim().parse().ok());

    (start, end)
}

/// El rango que se pide de verdad a YouTube: el pedido, recortado a un trozo.
pub fn clamp_range(start: u64, end: Option<u64>) -> (u64, u64) {
    let max_end = start + CHUNK_BYTES - 1;
    (start, end.map_or(max_end, |e| e.min(max_end)))
}

fn error(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(message.as_bytes().to_vec())
        .unwrap_or_default()
}

/// Atiende una peticion del `<audio>`.
pub async fn handle(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(target) = target_url(request.uri().path()) else {
        return error(StatusCode::FORBIDDEN, "solo audio de googlevideo");
    };

    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());
    let (start, end) = parse_range(range);
    let (start, end) = clamp_range(start, end);

    let upstream = match client()
        .get(&target)
        .header(header::RANGE, format!("bytes={start}-{end}"))
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            eprintln!("Proxy de audio: {e}");
            return error(StatusCode::BAD_GATEWAY, "no se pudo pedir el audio");
        }
    };

    let status = upstream.status();
    let content_type = upstream.headers().get(header::CONTENT_TYPE).cloned();
    let content_range = upstream.headers().get(header::CONTENT_RANGE).cloned();

    let body = match upstream.bytes().await {
        Ok(bytes) => bytes.to_vec(),
        Err(e) => {
            eprintln!("Proxy de audio: {e}");
            return error(StatusCode::BAD_GATEWAY, "el audio llego cortado");
        }
    };

    let mut response = Response::builder()
        .status(status.as_u16())
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Content-Length, Accept-Ranges",
        )
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, body.len());

    if let Some(value) = content_type {
        response = response.header(header::CONTENT_TYPE, value);
    }
    if let Some(value) = content_range {
        response = response.header(header::CONTENT_RANGE, value);
    }

    response.body(body).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acepta_solo_urls_de_googlevideo() {
        let buena = "https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1&x=y";
        let codificada = format!("/{}", percent_encoding::utf8_percent_encode(buena, percent_encoding::NON_ALPHANUMERIC));

        assert_eq!(target_url(&codificada).as_deref(), Some(buena));
    }

    #[test]
    fn rechaza_cualquier_otro_sitio() {
        for mala in [
            "https://evil.com/x",
            "https://googlevideo.com.evil.com/x",
            "http://rr3.googlevideo.com/x",
            "file:///C:/Windows/win.ini",
        ] {
            let codificada = format!("/{}", percent_encoding::utf8_percent_encode(mala, percent_encoding::NON_ALPHANUMERIC));
            assert_eq!(target_url(&codificada), None, "{mala}");
        }
    }

    #[test]
    fn lee_el_rango_pedido() {
        assert_eq!(parse_range(Some("bytes=0-")), (0, None));
        assert_eq!(parse_range(Some("bytes=100-199")), (100, Some(199)));
        assert_eq!(parse_range(None), (0, None));
        assert_eq!(parse_range(Some("basura")), (0, None));
    }

    #[test]
    fn recorta_a_un_trozo_lo_que_pide_hasta_el_final() {
        assert_eq!(clamp_range(0, None), (0, CHUNK_BYTES - 1));
        assert_eq!(clamp_range(5_000_000, None), (5_000_000, 5_000_000 + CHUNK_BYTES - 1));
        assert_eq!(clamp_range(0, Some(99)), (0, 99), "lo pequeno se respeta");
        assert_eq!(clamp_range(0, Some(10_000_000)), (0, CHUNK_BYTES - 1));
    }
}
