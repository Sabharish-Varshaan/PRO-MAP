from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


app = FastAPI(title="PROMAP API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    project_description: str


MOCK_RESPONSE = {
    "nodes": [
        {
            "id": "n1",
            "type": "task",
            "position": {"x": 100, "y": 100},
            "data": {
                "label": "Setup Database",
                "description": "Create DB schema",
                "parallel": False,
            },
        },
        {
            "id": "n2",
            "type": "task",
            "position": {"x": 300, "y": 200},
            "data": {
                "label": "Build Backend",
                "description": "Develop APIs",
                "parallel": False,
            },
        },
    ],
    "edges": [
        {
            "id": "e-n1-n2",
            "source": "n1",
            "target": "n2",
        }
    ],
    "order": ["n1", "n2"],
}


@app.get("/health")
def health_check() -> dict:
    return {"status": "running"}


@app.post("/generate")
def generate_workflow(_: GenerateRequest) -> dict:
    return MOCK_RESPONSE
