# BlockAds Filter Compiler API — Makefile
# ════════════════════════════════════════════════════════════

.PHONY: help build run test clean deps docker-compose-up cli

help: ## Show help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

deps: ## Download Go module dependencies
	go mod tidy
	go mod download

build: deps ## Build the API server binary
	go build -o bin/server ./cmd/server

run: deps ## Run the API server locally
	go run ./cmd/server

cli: deps ## Run the original CLI tool
	go run main.go

test: ## Run all tests
	go test -v ./...

clean: ## Remove build artifacts
	rm -rf bin/ tmp/

docker-compose-up: ## Start PostgreSQL and the API server via Docker Compose
	docker compose up --build -d

docker-compose-down: ## Stop Docker Compose services
	docker compose down -v
