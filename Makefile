# Lifedash - common dev and self-host commands.
# Run `make help` to list targets.

PYTHON ?= python3
UV ?= uv
VENV = server/.venv

.PHONY: help quickstart setup setup-check test-setup install test test-app test-server test-keyboard test-selfhost build dev dev-app dev-server docker-up docker-down docker-build docker-logs

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

quickstart: ## Install dependencies (if needed) and start local dev stack
	@if [ ! -d "app/node_modules" ]; then cd app && npm ci; fi
	@cd server && $(UV) sync --all-groups
	@$(MAKE) dev

setup: ## Guided self-host setup (asks before starting Docker services)
	$(PYTHON) scripts/setup.py

setup-check: ## Read-only Docker/Compose/config preflight (never starts services)
	$(PYTHON) scripts/setup.py --check

test-setup: ## Test setup safety paths with mocked subprocesses (no Docker)
	$(PYTHON) -m unittest discover -s scripts -p test_setup.py

install: ## Install app and server dependencies
	cd app && npm ci
	cd server && $(UV) sync --all-groups

test: test-app test-server ## Run all tests

test-app: ## Run app unit tests
	cd app && npm test

test-keyboard: ## Run sample-only desktop/phone keyboard browser checks (Chrome required)
	cd app && npm run test:keyboard

test-server: ## Run sync server tests
	cd server && $(UV) run pytest -q

test-selfhost: ## Disposable loopback restart and SQLite backup/restore smoke check (POSIX)
	cd server && $(UV) run python ../scripts/check-selfhost.py

build: ## Production build of the app (app/dist)
	cd app && npm run build

dev: ## Run app and sync server together (Ctrl-C stops both)
	$(PYTHON) scripts/dev.py

dev-app: ## Run just the app dev server
	cd app && npm run dev

dev-server: ## Run just the sync server
	cd server && SYNC_DB=$${SYNC_DB:-./dev.db} SYNC_OPEN_REGISTRATION=$${SYNC_OPEN_REGISTRATION:-1} $(UV) run uvicorn app.main:app --host 127.0.0.1 --port 8787 --no-proxy-headers

docker-up: ## Build and start the full stack (app on :8080, sync on :8787)
	docker compose up --build -d

docker-down: ## Stop the stack (data volume is kept)
	docker compose down

docker-build: ## Build images without starting
	docker compose build

docker-logs: ## Follow container logs
	docker compose logs -f
