# ════════════════════════════════════════════════════════════
# Multi-stage build for the BlockAds Filter Compiler API
# ════════════════════════════════════════════════════════════

# ── Stage 1: Build ──
FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /server ./cmd/server

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
