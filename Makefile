.PHONY: dev dev-frontend dev-backend migrate test install

# Start both servers (requires two terminals or tmux — use 'make dev' with a process manager)
dev:
	@bash dev.sh

dev-frontend:
	cd frontend && npm run dev

dev-backend:
	cd backend && .venv/bin/uvicorn main:app --reload --port 8000

install:
	cd frontend && npm install
	cd backend && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt

migrate:
	cd backend && .venv/bin/alembic upgrade head

test:
	cd backend && .venv/bin/pytest

docker-up:
	docker compose up -d

docker-down:
	docker compose down
