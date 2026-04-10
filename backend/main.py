import json
import os
import re
import time

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel

from mock_data import MOCK_JSON


load_dotenv()


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


client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def _extract_json_content(content: str) -> str:
    cleaned = content.strip()

    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 3:
            cleaned = "\n".join(lines[1:-1]).strip()

    return cleaned


def clean_text(text: str) -> str:
    return text.replace("```json", "").replace("```", "")


def _is_placeholder_label(label: str) -> bool:
    normalized = label.strip().lower()
    return normalized in {"", "task", "task 1", "step", "step 1", "node", "node 1"} or bool(
        re.fullmatch(r"(?:task|step|node|n)\s*\d+", normalized)
    )


def extract_json(text: str) -> dict:
    try:
        import json
        import re

        text = text.replace("```json", "").replace("```", "")

        match = re.search(r"\{.*\}", text, re.DOTALL)
        json_text = match.group()
        json_text = json_text.rstrip(", \n")

        return json.loads(json_text)
    except Exception as e:
        print("JSON ERROR:", e)
        return None


def fix_nodes(data: dict) -> dict:
    nodes = data.get("nodes", []) if isinstance(data, dict) else []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if "type" not in node:
            node["type"] = "default"
        if "position" not in node:
            node["position"] = {"x": 0, "y": 0}
    return data


def fix_edges(data: dict) -> dict:
    edges = data.get("edges", []) if isinstance(data, dict) else []
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            continue
        if "id" not in edge:
            edge["id"] = f"e{index}"
    return data


def normalize_edges(data: dict) -> dict:
    fixed_edges = []

    for index, edge in enumerate(data.get("edges", [])):
        if not isinstance(edge, dict):
            continue

        source = edge.get("source") or edge.get("from")
        target = edge.get("target") or edge.get("to")

        fixed_edges.append(
            {
                "id": str(edge.get("id") or f"e{index}"),
                "source": source,
                "target": target,
            }
        )

    data["edges"] = fixed_edges
    return data


def _has_valid_workflow_shape(workflow: dict) -> bool:
    return bool(
        isinstance(workflow, dict)
        and isinstance(workflow.get("nodes"), list)
        and isinstance(workflow.get("edges"), list)
        and isinstance(workflow.get("order"), list)
    )


def _is_valid_workflow_shape(workflow: dict) -> bool:
    if not isinstance(workflow, dict):
        return False

    required_keys = ("nodes", "edges", "order")
    if not all(key in workflow for key in required_keys):
        return False

    if not isinstance(workflow["nodes"], list):
        return False
    if not isinstance(workflow["edges"], list):
        return False
    if not isinstance(workflow["order"], list):
        return False

    return True


def _normalize_workflow_shape(workflow: dict) -> dict:
    normalized_nodes = []
    node_id_map = {}
    raw_nodes = workflow.get("nodes", [])[:6]

    for index, node in enumerate(raw_nodes, start=1):
        if not isinstance(node, dict):
            continue

        raw_id = str(node.get("id") or f"n{index}")
        label = (
            node.get("data", {}).get("label")
            if isinstance(node.get("data"), dict)
            else None
        )
        label = label or node.get("label") or node.get("name") or f"Task {index}"

        description = (
            node.get("data", {}).get("description")
            if isinstance(node.get("data"), dict)
            else None
        )
        description = description or node.get("description") or ""
        if _is_placeholder_label(str(label)) and description:
            label = description

        features = (
            node.get("data", {}).get("features")
            if isinstance(node.get("data"), dict)
            else None
        )
        if not isinstance(features, list):
            features = node.get("features") if isinstance(node.get("features"), list) else []

        modules = (
            node.get("data", {}).get("modules")
            if isinstance(node.get("data"), dict)
            else None
        )
        if not isinstance(modules, list):
            modules = node.get("modules") if isinstance(node.get("modules"), list) else []

        priority = (
            node.get("data", {}).get("priority")
            if isinstance(node.get("data"), dict)
            else None
        )
        priority = priority or node.get("priority") or "Medium"
        if priority not in ("High", "Medium", "Low"):
            priority = "Medium"

        normalized_nodes.append(
            {
                "id": raw_id,
                "type": "task",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": str(label),
                    "description": str(description),
                    "features": [str(item) for item in features if item],
                    "modules": [str(item) for item in modules if item],
                    "priority": priority,
                    "parallel": bool(
                        node.get("data", {}).get("parallel", False)
                        if isinstance(node.get("data"), dict)
                        else False
                    ),
                },
            }
        )
        node_id_map[raw_id] = True

    node_order = [node["id"] for node in normalized_nodes]
    node_index_map = {node_id: index for index, node_id in enumerate(node_order)}

    normalized_edges = []
    for index, edge in enumerate(workflow.get("edges", []), start=1):
        if not isinstance(edge, dict):
            continue

        source = str(edge.get("source") or edge.get("from") or "")
        target = str(edge.get("target") or edge.get("to") or "")

        if not source or not target:
            continue
        if source not in node_id_map or target not in node_id_map:
            continue
        if node_index_map.get(source, 0) >= node_index_map.get(target, 0):
            continue

        edge_id = str(edge.get("id") or f"e-{source}-{target}-{index}")
        normalized_edges.append(
            {
                "id": edge_id,
                "source": source,
                "target": target,
            }
        )

    if not normalized_edges and len(node_order) > 1:
        for index in range(len(node_order) - 1):
            source = node_order[index]
            target = node_order[index + 1]
            normalized_edges.append(
                {
                    "id": f"e-{source}-{target}-{index + 1}",
                    "source": source,
                    "target": target,
                }
            )

    normalized_order = []
    for node_id in workflow.get("order", []):
        node_id_str = str(node_id)
        if node_id_str in node_id_map:
            normalized_order.append(node_id_str)

    if not normalized_order:
        normalized_order = [node["id"] for node in normalized_nodes]

    normalized = {
        "nodes": normalized_nodes,
        "edges": normalized_edges,
        "order": normalized_order,
        "explanation": str(workflow.get("explanation") or ""),
    }

    if not normalized_nodes:
        raise ValueError("No valid nodes in GPT workflow")

    return normalized


def _add_insights(workflow: dict) -> dict:
    nodes_by_id = {node["id"]: node for node in workflow.get("nodes", [])}
    order = workflow.get("order", [])

    start_node = nodes_by_id.get(order[0]) if order else None
    end_node = nodes_by_id.get(order[-1]) if order else None
    bottleneck_node = next(
        (
            node
            for node in workflow.get("nodes", [])
            if node.get("data", {}).get("priority") == "High"
        ),
        workflow.get("nodes", [None])[0],
    )

    workflow["insights"] = {
        "start": start_node["data"]["label"] if start_node else "",
        "end": end_node["data"]["label"] if end_node else "",
        "bottleneck": bottleneck_node["data"]["label"] if bottleneck_node else "",
    }
    workflow["explanation"] = workflow.get("explanation") or "This workflow follows standard development steps."

    return workflow


def _move_ui_task_earlier(workflow: dict) -> dict:
    order = workflow.get("order", [])
    if len(order) < 2:
        return workflow

    nodes_by_id = {node["id"]: node for node in workflow.get("nodes", [])}
    last_node_id = order[-1]
    last_node = nodes_by_id.get(last_node_id, {})
    label = str(last_node.get("data", {}).get("label") or "")

    if "ui" not in label.lower():
        return workflow

    moved_order = order[:-2] + [last_node_id, order[-2]]
    workflow["order"] = moved_order
    return workflow


def generate_with_gpt(idea: str) -> dict:
    prompt = f"""
You are a senior software architect.

Convert this idea into a DETAILED development workflow.

Each task MUST include:
- Feature list
- Modules/components involved

Return ONLY JSON:
{{
  "nodes": [...],
  "edges": [...],
  "order": [...],
  "explanation": "Why these tasks are structured this way"
}}

IMPORTANT:
Edges MUST be in this format:
{{
    "id": "e1",
    "source": "n1",
    "target": "n2"
}}

DO NOT use "from" or "to"

STRICT RULES:
- 5-6 tasks only
- Features must be REAL (not generic)
- Modules must be technical (API, DB, UI components, etc.)
- Avoid vague words like 'system' or 'logic'
- Be practical and specific

Example node:
{{
    "id": "n1",
    "type": "task",
    "position": {{"x": 0, "y": 0}},
    "data": {{
        "label": "Design menu browsing flow",
        "description": "Plan how users search and browse food items",
        "features": ["Menu browsing", "Search filters"],
        "modules": ["Menu UI", "Search API"],
        "priority": "High",
        "parallel": false
    }}
}}

Idea: {idea}
"""

    messages = [
        {
            "role": "system",
            "content": "You are a senior software architect. Output structured, logical workflows only.",
        },
        {"role": "user", "content": prompt},
    ]

    start_time = time.time()

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=0.2,
        max_tokens=1000,
    )

    content = response.choices[0].message.content or ""
    print("RAW GPT:", content)
    content = clean_text(content)
    parsed = extract_json(content)
    if not parsed:
        raise ValueError("Invalid JSON")
    if not _has_valid_workflow_shape(parsed):
        raise ValueError("Invalid workflow JSON shape from GPT")

    parsed = fix_nodes(parsed)
    parsed = fix_edges(parsed)
    parsed = normalize_edges(parsed)

    normalized = _normalize_workflow_shape(parsed)
    normalized = _move_ui_task_earlier(normalized)
    print(f"Response time: {time.time() - start_time:.3f}s")

    return _add_insights(normalized)


@app.get("/health")
def health_check() -> dict:
    return {"status": "running"}


@app.post("/generate")
def generate(data: GenerateRequest) -> dict:
    try:
        result = generate_with_gpt(data.project_description)
        if not result or "order" not in result or len(result["order"]) < 2:
            return MOCK_JSON
        if not result.get("nodes") or not result.get("edges"):
            return MOCK_JSON
        return result
    except Exception:
        fallback = dict(MOCK_JSON)
        fallback["explanation"] = "Fallback workflow used due to AI failure."
        if "explanation" not in fallback:
            fallback["explanation"] = "This workflow follows standard development steps."
        result = _add_insights(_normalize_workflow_shape(fallback))
        if not result or "order" not in result or len(result["order"]) < 2:
            return MOCK_JSON

        return result