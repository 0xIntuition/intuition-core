SHELL := /bin/sh

COMPOSE ?= docker compose
API_URL ?= http://localhost:3000
KEY_NAME ?= me
ACCOUNT ?= 0xYourWallet

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help.
	@awk 'BEGIN { FS = ":.*##"; printf "\nIntuition Core developer commands\n\n" } /^[a-zA-Z0-9_.-]+:.*##/ { printf "  %-18s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

.PHONY: bootstrap
bootstrap: ## Run preflight checks, install dependencies, start Compose, and wait for API health.
	@scripts/bootstrap.sh

.PHONY: bootstrap-index
bootstrap-index: ## Run bootstrap with the indexing profile enabled.
	@scripts/bootstrap.sh --indexing

.PHONY: install
install: ## Install Bun workspace dependencies with the frozen lockfile.
	bun install --frozen-lockfile

.PHONY: up
up: ## Start the default Docker Compose stack in the background.
	$(COMPOSE) up -d

.PHONY: index
index: ## Start Docker Compose with the indexing profile in the background.
	$(COMPOSE) --profile indexing up -d

.PHONY: down
down: ## Stop Docker Compose services and keep volumes.
	$(COMPOSE) --profile indexing down --remove-orphans

.PHONY: reset
reset: ## Stop Docker Compose services and remove local volumes.
	$(COMPOSE) --profile indexing down -v --remove-orphans

.PHONY: logs
logs: ## Follow Docker Compose logs. Use SERVICE=api to narrow output.
	$(COMPOSE) logs -f $(SERVICE)

.PHONY: status
status: ## Show Docker Compose service status.
	$(COMPOSE) --profile indexing ps

.PHONY: smoke
smoke: ## Run the local API/workers/triples integration smoke test.
	@scripts/smoke-test.sh

.PHONY: smoke-index
smoke-index: ## Run the bounded public testnet indexing smoke test.
	@scripts/smoke-index.sh

.PHONY: keys
keys: ## Mint a local API key. Override KEY_NAME and ACCOUNT as needed.
	DATABASE_KG_URL=postgresql://intuition:intuition@localhost:5432/intuition_kg \
		bun --filter @0xintuition/api run keys:create -- --name $(KEY_NAME) --account $(ACCOUNT)

.PHONY: test
test: ## Run the test suite.
	bun run test

.PHONY: lint
lint: ## Run lint checks.
	bun run lint

.PHONY: typecheck
typecheck: ## Run TypeScript type checks.
	bun run typecheck

.PHONY: check
check: ## Run repository checks.
	bun run check
