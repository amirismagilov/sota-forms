#!/usr/bin/env bash
# Run the whole stack locally WITHOUT Docker (needs: Python 3.12, Node 20, PostgreSQL, optionally Redis).
# For the Docker path just use:  docker compose up --build
set -euo pipefail
cd "$(dirname "$0")"

export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://forms:forms@127.0.0.1:5432/forms}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}"
export MOCK_WEBHOOK_URL="${MOCK_WEBHOOK_URL:-http://127.0.0.1:8000/api/mock/webhook}"
export MOCK_EXT_BASE="${MOCK_EXT_BASE:-http://127.0.0.1:8000/api/mock/ext}"
export BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"

echo "==> Backend deps"
cd backend
python3 -m venv .venv 2>/dev/null || true
. .venv/bin/activate
pip install -q -r requirements.txt

echo "==> Starting API (:8000) + execute-worker"
pkill -f "uvicorn app.main" 2>/dev/null || true
pkill -f "app.worker.webhook_worker" 2>/dev/null || true
nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 >/tmp/sota-backend.log 2>&1 &
nohup python -m app.worker.webhook_worker >/tmp/sota-worker.log 2>&1 &
cd ..

echo "==> Frontend deps + embeddable widget bundle"
cd frontend
npm install
npm run build:widget
echo "==> Starting UI (:5173)"
pkill -f "vite" 2>/dev/null || true
nohup npm run dev >/tmp/sota-frontend.log 2>&1 &
cd ..

sleep 6
echo
echo "  UI:        http://localhost:5173     (login: demo@sota.forms / demo12345)"
echo "  Embed demo: http://localhost:5173/embed-demo.html"
echo "  API/Swagger: http://localhost:8000/docs"
echo
echo "Logs: /tmp/sota-backend.log  /tmp/sota-worker.log  /tmp/sota-frontend.log"
