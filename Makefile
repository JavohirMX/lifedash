# Lifedash - common dev and self-host commands.
# Run `make help` to list targets.

.PHONY: help install test test-app test-server build dev dev-app dev-server docker-up docker-down docker-build docker-logs

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

install: ## Install app and server dependencies
	cd app && npm ci
	cd server && pip install -r requirements.txt

test: test-app test-server ## Run all tests

test-app: ## Run app unit tests
	cd app && npm test

test-server: ## Run sync server tests
	cd server && python3 -m pytest -q

build: ## Production build of the app (app/dist)
	cd app && npm run build

dev: ## Run app and sync server together (Ctrl-C stops both)
	cd app && npm run dev:all

dev-app: ## Run just the app dev server
	cd app && npm run dev

dev-server: ## Run just the sync server
	cd server && uvicorn app.main:app --host 0.0.0.0 --port 8787

docker-up: ## Build and start the full stack (app on :8080, sync on :8787)
	docker compose up --build -d

docker-down: ## Stop the stack (data volume is kept)
	docker compose down

docker-build: ## Build images without starting
	docker compose build

docker-logs: ## Follow container logs
	docker compose logs -f
