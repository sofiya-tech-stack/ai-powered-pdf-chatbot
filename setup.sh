#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# DocMind – AI PDF Chatbot
# One-shot setup & run script for macOS
# Usage: chmod +x setup.sh && ./setup.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e  # Exit on any error

BOLD='\033[1m'
GREEN='\033[0;32m'
GOLD='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo -e "${BOLD}${GOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GOLD}║   DocMind – AI PDF Chatbot Setup     ║${NC}"
echo -e "${BOLD}${GOLD}╚══════════════════════════════════════╝${NC}"
echo ""

# ── 1. Check prerequisites ──────────────────────────────────────────────────
echo -e "${BOLD}[1/6] Checking prerequisites…${NC}"

if ! command -v python3 &>/dev/null; then
  echo -e "${RED}✗ Python 3 not found. Install from https://python.org${NC}"; exit 1
fi
PYTHON_VER=$(python3 --version | cut -d' ' -f2)
echo -e "  ${GREEN}✓ Python $PYTHON_VER${NC}"

if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found. Install from https://nodejs.org${NC}"; exit 1
fi
NODE_VER=$(node --version)
echo -e "  ${GREEN}✓ Node.js $NODE_VER${NC}"

if ! command -v npm &>/dev/null; then
  echo -e "${RED}✗ npm not found. Install Node.js from https://nodejs.org${NC}"; exit 1
fi
echo -e "  ${GREEN}✓ npm $(npm --version)${NC}"

# ── 2. Check Ollama ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/6] Checking Ollama (local LLM)…${NC}"

if ! command -v ollama &>/dev/null; then
  echo -e "  ${RED}✗ Ollama not found. Install from https://ollama.com${NC}"; exit 1
fi
echo -e "  ${GREEN}✓ Ollama installed${NC}"

if ! curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo -e "  ${GOLD}⚠ Ollama doesn't seem to be running. Start it with 'ollama serve' in another terminal.${NC}"
else
  echo -e "  ${GREEN}✓ Ollama is running${NC}"
fi

if ! ollama list 2>/dev/null | grep -q "llama3"; then
  echo -e "  ${GOLD}⚠ 'llama3' model not found locally. Pulling it now (this can take a while)…${NC}"
  ollama pull llama3
fi
echo -e "  ${GREEN}✓ llama3 model available${NC}"

# ── 3. Backend setup ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/6] Setting up Python backend…${NC}"

cd backend

# Create venv if not exists
if [ ! -d "venv" ]; then
  echo "  Creating Python virtual environment…"
  python3 -m venv venv
fi

echo "  Activating virtual environment…"
source venv/bin/activate

echo "  Installing Python dependencies (this may take a few minutes on first run)…"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

echo -e "  ${GREEN}✓ Backend dependencies installed${NC}"
cd ..

# ── 4. Frontend setup ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/6] Setting up React frontend…${NC}"

cd frontend
echo "  Installing Node.js dependencies…"
npm install --silent
echo -e "  ${GREEN}✓ Frontend dependencies installed${NC}"
cd ..

# ── 5. Launch backend ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[5/6] Starting FastAPI backend on :8000…${NC}"

cd backend
source venv/bin/activate

uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo -e "  ${GREEN}✓ Backend started (PID $BACKEND_PID)${NC}"
cd ..

# Wait for backend to be ready
echo "  Waiting for backend to be ready…"
for i in {1..20}; do
  if curl -s http://localhost:8000/health >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓ Backend is ready${NC}"
    break
  fi
  sleep 1
done

# ── 6. Launch frontend ──────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[6/6] Starting React frontend on :3000…${NC}"

cd frontend
npm run dev &
FRONTEND_PID=$!
echo -e "  ${GREEN}✓ Frontend started (PID $FRONTEND_PID)${NC}"
cd ..

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║   DocMind is running!                    ║${NC}"
echo -e "${BOLD}${GREEN}║                                          ║${NC}"
echo -e "${BOLD}${GREEN}║   Frontend: http://localhost:3000        ║${NC}"
echo -e "${BOLD}${GREEN}║   Backend:  http://localhost:8000        ║${NC}"
echo -e "${BOLD}${GREEN}║   API Docs: http://localhost:8000/docs   ║${NC}"
echo -e "${BOLD}${GREEN}║                                          ║${NC}"
echo -e "${BOLD}${GREEN}║   Press Ctrl+C to stop both servers      ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""

# Cleanup on Ctrl+C
trap "echo ''; echo 'Shutting down…'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM

# Keep script alive
wait
