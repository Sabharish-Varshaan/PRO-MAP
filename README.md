# PROMAP - Intelligent Workflow Structuring Assistant

PROMAP converts a natural language project description into a structured workflow with tasks, dependencies, and execution order.

For this MVP, the backend returns a mock workflow response and the frontend renders it as a graph.

## Project Structure

```
PROMAP/
  backend/
    main.py
    requirements.txt
  frontend/
    (Vite React app)
  README.md
```

## Backend Setup

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Backend runs at: `http://localhost:8000`

### Endpoints

- `GET /health` -> `{ "status": "running" }`
- `POST /generate` -> returns mock workflow JSON

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at: `http://localhost:5173`

## Functional Flow

1. User enters project text in input box.
2. User clicks **Generate Workflow**.
3. Frontend sends POST request to `http://localhost:8000/generate`.
4. Backend returns mock nodes/edges/order JSON.
5. Frontend renders nodes and edges in React Flow.

## Notes

- OpenAI integration is intentionally not implemented yet.
- NetworkX DAG generation is intentionally not implemented yet.
- This is a minimal hackathon-ready demo.
