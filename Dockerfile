# Builders run natively; Go cross-compiles the final executable.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/tsconfig.json web/vite.config.ts web/index.html web/sync-assets.mjs ./
COPY web/src ./src
COPY img /src/img
COPY svg /src/svg
COPY sfx /src/sfx
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.23-alpine AS backend
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
# Original catalog and artwork are mandatory parity-test fixtures, not runtime code.
COPY cards.js ./
COPY img ./img
ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN go test ./... && go vet ./... && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags='-s -w -buildid=' -o /out/gwent ./cmd/gwent
RUN mkdir -p /out/data

FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.source="https://github.com/maintainer64/gwent-classic"
WORKDIR /app
COPY --from=backend --chown=65532:65532 /out/gwent /app/gwent
COPY --from=frontend --chown=65532:65532 /src/web/dist /app/public
COPY --chown=65532:65532 LICENSE /app/LICENSE
COPY --from=backend --chown=65532:65532 /out/data /data
ENV STATIC_DIR=/app/public DATA_DIR=/data LISTEN_ADDR=:8080
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/app/gwent"]
