import json
import os
import re
import time

import networkx as nx
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


client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", "").strip())


def _extract_json_content(content: str) -> str:
    cleaned = content.strip()

    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 3:
            cleaned = "\n".join(lines[1:-1]).strip()

    return cleaned


def clean_text(text: str) -> str:
    return text.replace("```json", "").replace("```", "")


def _find_json_object(text: str) -> str:
    start = text.find("{")
    if start == -1:
        return None

    brace_count = 0
    in_string = False
    escape = False

    for index, char in enumerate(text[start:], start):
        if char == '"' and not escape:
            in_string = not in_string
        if char == '\\' and not escape:
            escape = True
            continue
        if escape:
            escape = False
        if not in_string:
            if char == '{':
                brace_count += 1
            elif char == '}':
                brace_count -= 1
                if brace_count == 0:
                    return text[start:index + 1]
    return None


def _normalize_json_string(json_text: str) -> str:
    normalized_chars = []
    in_string = False
    escape = False

    for char in json_text:
        if char == '"' and not escape:
            in_string = not in_string
            normalized_chars.append(char)
            continue
        if char == '\\' and not escape:
            escape = True
            normalized_chars.append(char)
            continue
        if escape:
            escape = False
            normalized_chars.append(char)
            continue
        if in_string and char in {'\n', '\r'}:
            normalized_chars.append(' ')
        else:
            normalized_chars.append(char)

    return ''.join(normalized_chars)


def _is_placeholder_label(label: str) -> bool:
    normalized = label.strip().lower()
    return normalized in {"", "task", "task 1", "step", "step 1", "node", "node 1"} or bool(
        re.fullmatch(r"(?:task|step|node|n)\s*\d+", normalized)
    )


def _attempt_recover_json(json_text: str) -> str:
    json_text = _normalize_json_string(json_text)

    if json_text.count('"') % 2 != 0:
        json_text += '"'

    open_braces = json_text.count('{') - json_text.count('}')
    open_brackets = json_text.count('[') - json_text.count(']')
    if open_braces > 0:
        json_text += '}' * open_braces
    if open_brackets > 0:
        json_text += ']' * open_brackets

    try:
        json.loads(json_text)
        return json_text
    except Exception:
        pass

    trimmed = json_text
    while trimmed and trimmed[-1] not in '}]':
        trimmed = trimmed[:-1]
    if trimmed and trimmed[-1] == ',':
        trimmed = trimmed[:-1]

    try:
        json.loads(trimmed)
        return trimmed
    except Exception:
        return None


def extract_json(text: str) -> dict:
    try:
        json_text = clean_text(text)
        json_text = _find_json_object(json_text)
        if not json_text:
            raise ValueError("No JSON object found")

        json_text = _normalize_json_string(json_text)
        try:
            return json.loads(json_text)
        except Exception:
            recovered = _attempt_recover_json(json_text)
            if recovered:
                return json.loads(recovered)
            raise
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
    )


def _is_valid_workflow_shape(workflow: dict) -> bool:
    if not isinstance(workflow, dict):
        return False

    if "nodes" not in workflow or "edges" not in workflow:
        return False

    if not isinstance(workflow["nodes"], list):
        return False
    if not isinstance(workflow["edges"], list):
        return False

    return True


def _normalize_workflow_shape(workflow: dict) -> dict:
    normalized_nodes = []
    node_id_map = {}
    raw_nodes = workflow.get("nodes", [])[:8]

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


def _analyze_workflow_graph(workflow: dict) -> dict:
    if not isinstance(workflow, dict):
        return workflow

    graph = nx.DiGraph()
    graph.add_nodes_from(
        str(node.get("id"))
        for node in workflow.get("nodes", [])
        if isinstance(node, dict) and node.get("id")
    )

    for edge in workflow.get("edges", []):
        if not isinstance(edge, dict):
            continue
        source = edge.get("source") or edge.get("from")
        target = edge.get("target") or edge.get("to")
        if not source or not target:
            continue
        graph.add_edge(str(source), str(target))

    if not nx.is_directed_acyclic_graph(graph):
        raise ValueError("Workflow graph is not a DAG")

    workflow["order"] = list(nx.topological_sort(graph))

    levels = {}
    for node in workflow["order"]:
        preds = list(graph.predecessors(node))
        if preds:
            level = max(levels[p] for p in preds) + 1
        else:
            level = 0
        levels[node] = level

    parallel_groups = {}
    for node, lvl in levels.items():
        parallel_groups.setdefault(lvl, []).append(node)

    workflow["parallel_groups"] = [parallel_groups[lvl] for lvl in sorted(parallel_groups)]
    workflow["critical_path"] = nx.dag_longest_path(graph)
    workflow["bottlenecks"] = [
        node for node in graph.nodes() if graph.in_degree(node) + graph.out_degree(node) >= 2
    ]

    critical_set = set(str(node_id) for node_id in workflow["critical_path"])
    bottleneck_set = set(str(node_id) for node_id in workflow["bottlenecks"])

    for node in workflow.get("nodes", []):
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id"))
        data = node.get("data")
        if not isinstance(data, dict):
            data = {}
            node["data"] = data

        data["is_critical"] = node_id in critical_set
        data["is_bottleneck"] = node_id in bottleneck_set

        degree = graph.in_degree(node_id) + graph.out_degree(node_id)
        if degree >= 3:
            difficulty = "Hard"
        elif degree >= 2:
            difficulty = "Medium"
        else:
            difficulty = "Easy"
        data["difficulty"] = difficulty

    workflow["confidence"] = compute_confidence(workflow, graph)

    return workflow


def generate_explanation(data: dict) -> str:
    num_tasks = len(data.get("nodes", []))
    critical_path = data.get("critical_path", [])
    parallel_groups = data.get("parallel_groups", [])
    bottlenecks = data.get("bottlenecks", [])

    explanation = f"This workflow contains {num_tasks} tasks."
    if critical_path:
        explanation += " The critical path defines the main execution flow."
    if len(parallel_groups) > 1:
        explanation += " Some tasks can be executed in parallel to optimize time."
    if bottlenecks:
        explanation += " Bottlenecks represent tasks with high dependencies."

    return explanation


def compute_confidence(data: dict, graph) -> float:
    score = 0.5

    if nx.is_directed_acyclic_graph(graph):
        score += 0.2

    critical_path = data.get("critical_path", [])
    if len(critical_path) > 2:
        score += 0.1

    parallel_groups = data.get("parallel_groups", [])
    if len(parallel_groups) > 1:
        score += 0.1

    bottlenecks = data.get("bottlenecks", [])
    if bottlenecks:
        score += 0.1

    return min(score, 1.0)


def validate_output(data: dict) -> dict:
    required_fields = {
        "nodes": [],
        "edges": [],
        "order": [],
        "parallel_groups": [],
        "critical_path": [],
        "bottlenecks": [],
        "confidence": 0.0,
        "explanation": "Workflow generated successfully"
    }

    for field, default in required_fields.items():
        if field not in data:
            data[field] = default

    return data


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
    workflow["explanation"] = generate_explanation(workflow)

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
    try:
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
- 6-8 tasks only
- Clear dependencies
- Avoid redundant steps
- Do not use multiline strings in any value
- Do not include newline characters inside JSON string values
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
            max_tokens=1400,
        )

        content = response.choices[0].message.content or ""
        print("RAW GPT:", content)
        content = clean_text(content)
        parsed = extract_json(content)
        if not parsed:
            raise ValueError("Invalid JSON")
        if not _has_valid_workflow_shape(parsed):
            raise ValueError("Invalid workflow JSON shape from GPT")

        # Allow generating an order from nodes/edges if GPT omits it
        if "order" not in parsed or not isinstance(parsed.get("order"), list):
            parsed["order"] = []

        parsed = fix_nodes(parsed)
        parsed = fix_edges(parsed)
        parsed = normalize_edges(parsed)

        normalized = _normalize_workflow_shape(parsed)
        normalized = _move_ui_task_earlier(normalized)
        normalized = _analyze_workflow_graph(normalized)
        print(f"Response time: {time.time() - start_time:.3f}s")

        return validate_output(_add_insights(normalized))
    except Exception as e:
        fallback = dict(MOCK_JSON)
        fallback["error"] = "Workflow generation failed"
        fallback["fallback"] = True
        return validate_output(fallback)


@app.get("/health")
def health_check() -> dict:
    return {"status": "running"}


@app.post("/generate")
def generate(data: GenerateRequest) -> dict:
    result = generate_with_gpt(data.project_description)
    return result