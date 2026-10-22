FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /src/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY site.go ./
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /out/ourtaiko-api ./cmd/server

FROM alpine:3.23
RUN apk add --no-cache ca-certificates ffmpeg libwebp-tools curl \
    && addgroup -g 10001 app && adduser -D -u 10001 -G app app \
    && mkdir -p /data/files && chown -R app:app /data
COPY --from=build /out/ourtaiko-api /usr/local/bin/ourtaiko-api
USER 10001:10001
ENV LISTEN_ADDR=0.0.0.0:8080 STORAGE_DIR=/data/files
EXPOSE 8080
ENTRYPOINT ["ourtaiko-api"]
