FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY src ./src
COPY src-tauri/icons/icon.png ./src-tauri/icons/icon.png
COPY src-tauri/gen/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png ./src-tauri/gen/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
COPY scripts/build-web.mjs ./scripts/
COPY web ./web
RUN npm run web:build

FROM rust:1.99-bookworm AS backend
WORKDIR /build
COPY src-tauri/src ./src-tauri/src
COPY web-api ./web-api
RUN cargo build --release --locked --manifest-path web-api/Cargo.toml

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -m 0700 -o 10001 -g 10001 /data
COPY --from=frontend /build/dist/web /opt/antares/web
COPY --from=backend /build/web-api/target/release/antares-web-api /usr/local/bin/
ENV ANTARES_WEB_BIND=0.0.0.0:4173 ANTARES_WEB_DATA=/data ANTARES_WEB_DIST=/opt/antares/web
USER 10001:10001
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=4s CMD curl -fsS http://127.0.0.1:4173/api/health || exit 1
ENTRYPOINT ["antares-web-api"]
