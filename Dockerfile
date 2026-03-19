# ════════════════════════════════════════════════════════════
# Multi-stage build for the BlockAds Filter Compiler API
# ════════════════════════════════════════════════════════════

# ── Stage 1: Build ──
FROM golang:1.24-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /app

COPY go.mod go.sum ./
# Ignore errors if go.sum is incomplete
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download || true

COPY . .
# Run go mod tidy to ensure go.mod and go.sum are in sync
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod tidy
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /server ./cmd/server

# ── Stage 2: Runtime ──
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

# Create non-root user
RUN addgroup -S app && adduser -S app -G app
USER app

WORKDIR /app
COPY --from=builder /server .

EXPOSE 8080

ENTRYPOINT ["./server"]
