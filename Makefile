SHELL := /bin/sh

COMPOSE ?= docker compose
API_URL ?= http://localhost:3000
KEY_NAME ?= me
ACCOUNT ?= 0xYourWallet
SCOPE_CONFIG ?= docs/indexing-scope.example.json
override PUBLISHED_COMPOSE := docker-compose.yml:docker-compose.published.yml
IMAGE_TAG ?=

export IMAGE_TAG

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

.PHONY: require-image-tag
require-image-tag:
	@if [ -z "$$IMAGE_TAG" ]; then \
		printf 'IMAGE_TAG is required for published-image Make targets, for example: make up-published IMAGE_TAG=vX.Y.Z\n' >&2; \
		exit 1; \
	fi
	@case "$$IMAGE_TAG" in \
		*[!A-Za-z0-9._-]*) \
			printf 'IMAGE_TAG may only contain letters, numbers, dots, underscores, and hyphens. Use full INTUITION_CORE_*_IMAGE refs for digest pins.\n' >&2; \
			exit 1; \
			;; \
	esac

.PHONY: install
install: ## Install Bun workspace dependencies with the frozen lockfile.
	bun install --frozen-lockfile

.PHONY: up
up: ## Start the default Docker Compose stack in the background.
	$(COMPOSE) up -d

.PHONY: up-published
up-published: require-image-tag ## Start Docker Compose from published GHCR images. Requires IMAGE_TAG.
	COMPOSE_FILE="$(PUBLISHED_COMPOSE)" INTUITION_CORE_IMAGE_TAG="$$IMAGE_TAG" $(COMPOSE) up -d

.PHONY: index
index: ## Start Docker Compose with the indexing profile in the background.
	$(COMPOSE) --profile indexing up -d

.PHONY: index-published
index-published: require-image-tag ## Start the indexing profile from published GHCR images. Requires IMAGE_TAG.
	COMPOSE_FILE="$(PUBLISHED_COMPOSE)" INTUITION_CORE_IMAGE_TAG="$$IMAGE_TAG" $(COMPOSE) --profile indexing up -d

.PHONY: devnet
devnet: ## Start the local anvil chain and deploy the Intuition contracts onto it.
	$(COMPOSE) --profile devnet up -d anvil devnet-deploy

.PHONY: devnet-deploy
devnet-deploy: ## Deploy the contracts to an already-running anvil (native, no docker).
	bun run devnet:deploy

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

.PHONY: smoke-published
smoke-published: require-image-tag ## Run the API/workers/triples smoke test against published GHCR images.
	@COMPOSE_FILE="$(PUBLISHED_COMPOSE)" INTUITION_CORE_IMAGE_TAG="$$IMAGE_TAG" SMOKE_BUILD=0 scripts/smoke-test.sh

.PHONY: smoke-index
smoke-index: ## Run the bounded public testnet indexing smoke test.
	@scripts/smoke-index.sh

.PHONY: smoke-index-published
smoke-index-published: require-image-tag ## Run the bounded indexing smoke test against published GHCR images.
	@COMPOSE_FILE="$(PUBLISHED_COMPOSE)" INTUITION_CORE_IMAGE_TAG="$$IMAGE_TAG" SMOKE_BUILD=0 scripts/smoke-index.sh

.PHONY: scope-dry-run
scope-dry-run: ## Validate an IndexingScope config and print rindexer dry-run output. Override SCOPE_CONFIG.
	@bun run scope:dry-run "$(SCOPE_CONFIG)"

.PHONY: config-published
config-published: require-image-tag ## Validate the published-image Docker Compose config.
	@COMPOSE_FILE="$(PUBLISHED_COMPOSE)" INTUITION_CORE_IMAGE_TAG="$$IMAGE_TAG" $(COMPOSE) config -q

.PHONY: explore
explore: ## Print a guided snapshot of local KG tables, atoms, predicates, and artifacts.
	@scripts/explore-data.sh

.PHONY: keys
keys: ## Mint a local API key. Override KEY_NAME and ACCOUNT as needed.
	cd services/api && DATABASE_KG_URL=postgresql://intuition:intuition@localhost:5432/intuition_kg \
		bun run keys:create -- --name $(KEY_NAME) --account $(ACCOUNT)

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
