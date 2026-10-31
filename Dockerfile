FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /src/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
# The web half of OurTaikoSiteKit (the kit/ submodule) is a workspace package.
COPY kit/web/package.json /src/kit/web/
RUN pnpm install --frozen-lockfile
COPY kit/web/ /src/kit/web/
COPY kit/contracts/ /src/kit/contracts/
COPY web/ ./
RUN pnpm build

# TJAParser's command-line tool: the game's own parser, which reads every uploaded chart's
# blocks, hashes them and lists the notes the difficulty constants are computed from. Pin a tag
# whose hashes match the game's (OurTaikoPlay Packages/manifest.json): v0.4.0 adds the notes to
# v0.3.x and hashes the same.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS tjaparser
ARG TARGETARCH
ARG TJAPARSER_REF=v0.7.0
RUN apk add --no-cache git \
    && git clone --depth 1 --branch "$TJAPARSER_REF" https://github.com/OurTaiko/TJAParser.git /src
WORKDIR "/src/dotnet~"
# Self-contained, single-file and trimmed: the options live in tjaparser.csproj.
RUN rid=linux-musl-x64; [ "$TARGETARCH" = "arm64" ] && rid=linux-musl-arm64; \
    dotnet publish tjaparser -c Release -r "$rid" -o /out \
    && /out/tjaparser version

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETOS TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
# go.mod replaces ourtaiko.dev/sitekit with the kit/ submodule.
COPY kit/go.mod kit/go.sum ./kit/
RUN go mod download
COPY kit/ ./kit/
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY site.go ./
COPY --from=web /src/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags='-s -w' -o /out/ourtaiko-api ./cmd/server

FROM alpine:3.23
RUN apk add --no-cache ca-certificates ffmpeg libwebp-tools curl libstdc++ libgcc \
    && addgroup -g 10001 app && adduser -D -u 10001 -G app app \
    && mkdir -p /data/files && chown -R app:app /data
COPY --from=build /out/ourtaiko-api /usr/local/bin/ourtaiko-api
COPY --from=tjaparser /out/tjaparser /usr/local/bin/tjaparser
USER 10001:10001
ENV LISTEN_ADDR=0.0.0.0:8080 STORAGE_DIR=/data/files
EXPOSE 8080
ENTRYPOINT ["ourtaiko-api"]
