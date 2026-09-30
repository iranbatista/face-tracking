# Atalhos de desenvolvimento. Tudo do backend roda dentro de backend/.
B := cd backend &&

.PHONY: db migrate migration api worker test lint fmt

db:        ## Postgres de dev em 127.0.0.1:5432
	docker compose -f docker-compose.dev.yml up -d --wait db

migrate:   ## aplica as migrações pendentes
	$(B) uv run alembic upgrade head

migration: ## nova migração autogerada: make migration m="adiciona coluna x"
	$(B) uv run alembic revision --autogenerate -m "$(m)"

api:       ## API com reload em http://127.0.0.1:8000
	$(B) uv run uvicorn --factory foco.main:create_app --reload --reload-dir src

worker:    ## worker de indexação (Procrastinate)
	$(B) uv run procrastinate --app=foco.worker.app worker --concurrency=1

test:
	$(B) uv run pytest -q

lint:
	$(B) uv run ruff check . && uv run ruff format --check .

fmt:
	$(B) uv run ruff check --fix . && uv run ruff format .

F := pnpm --dir frontend

.PHONY: web web-test web-lint web-fmt gen-api

web:       ## frontend React em http://127.0.0.1:5173 (precisa de make api)
	$(F) dev

web-test:
	$(F) test

web-lint:
	$(F) lint

web-fmt:
	$(F) fmt

gen-api:   ## OpenAPI do backend -> frontend/src/api (openapi.json + schema.d.ts)
	$(B) uv run python scripts/export_openapi.py > ../frontend/src/api/openapi.json.tmp
	mv frontend/src/api/openapi.json.tmp frontend/src/api/openapi.json
	$(F) gen:api
