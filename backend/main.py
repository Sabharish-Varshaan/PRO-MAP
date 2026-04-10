import json
import os
import re
from typing import Any

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


class GenerateTasksRequest(BaseModel):
    project_description: str


class TaskItem(BaseModel):
    id: str
    label: str
    description: str
    features: list[str]
    modules: list[str]
    priority: str


class BuildGraphRequest(BaseModel):
    tasks: list[TaskItem]


class AnalyzeWorkflowRequest(BaseModel):
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]


class GatherRequirementsRequest(BaseModel):
    project_idea: str


class GenerateWorkflowRequest(BaseModel):
    requirements: dict[str, Any]


class GenerateInsightsRequest(BaseModel):
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    order: list[str]
    parallel_groups: list[list[str]]
    critical_path: list[str]
    bottlenecks: list[str]


client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", "").strip())


def generate_execution_insights(data: dict[str, Any]) -> dict[str, Any]:
    prompt = f"""
You are an expert system analyst.

Analyze this workflow graph and generate execution insights.

Workflow data: {json.dumps(data)}

Output ONLY valid JSON in this format:

{{
  "insights": {{
    "critical_path_analysis": "...",
    "bottleneck_analysis": "...",
    "parallel_execution": "...",
    "execution_strategy": "...",
    "optimization_suggestions": "..."
  }}
}}

Instructions:
- Explain critical path importance and delay impact (1-2 lines)
- Explain bottleneck risks (1-2 lines)
- Explain parallel execution benefits (1-2 lines)
- Provide step-by-step execution guidance (1-2 lines)
- Suggest optimizations like reducing dependencies or parallel running (1-2 lines)
- Keep concise and actionable
"""

    messages = [
        {
            "role": "system",
            "content": "You are a workflow analyst. Output valid JSON only.",
        },
        {"role": "user", "content": prompt},
    ]

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.2,
            max_tokens=800,
        )

        content = response.choices[0].message.content or ""
        json_text = _extract_json_block(content)
        if json_text:
            parsed = json.loads(json_text)
            return parsed
    except Exception as e:
        print("Insights generation error:", e)

    # Fallback
    return {
        "insights": {
            "critical_path_analysis": "Critical path determines minimum completion time. Delays here extend overall project duration.",
            "bottleneck_analysis": "Bottlenecks have high dependencies and are risk points for delays.",
            "parallel_execution": "Parallel groups can run simultaneously to improve efficiency.",
            "execution_strategy": "Follow topological order, prioritize critical path tasks.",
            "optimization_suggestions": "Reduce dependencies, run parallel tasks together, simplify workflow."
        }
    }


def generate_workflow_from_requirements(requirements: dict[str, Any]) -> dict[str, Any]:
    prompt = f"""
You are an expert system architect and workflow planner.

Convert these structured requirements into an executable workflow graph.

Input requirements: {json.dumps(requirements)}

Output ONLY valid JSON in this format:

{{
  "nodes": [
    {{
      "id": "n1",
      "type": "task",
      "position": {{"x": 0, "y": 0}},
      "data": {{
        "label": "...",
        "description": "...",
        "priority": "High/Medium/Low",
        "assigned_role": "Frontend/Backend/Designer/Tester",
        "source_requirement": "..."
      }}
    }}
  ],
  "edges": [
    {{
      "id": "e1",
      "source": "n1",
      "target": "n2"
    }}
  ],
  "order": ["n1", "n2"]
}}

Instructions:
- Generate 5-8 tasks total from requirements, user_actions, system_behavior
- Assign roles: UI/interaction → Frontend, API/logic/data → Backend, UX/design → Designer, validation/testing → Tester
- Assign priorities based on priority_features: High for critical, Medium for supporting, Low for optional
- Create logical dependencies (no cycles)
- Ensure dependency-consistent order
- Keep tasks meaningful and non-redundant
"""

    messages = [
        {
            "role": "system",
            "content": "You are a workflow planner. Output valid JSON only.",
        },
        {"role": "user", "content": prompt},
    ]

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.2,
            max_tokens=1200,
        )

        content = response.choices[0].message.content or ""
        json_text = _extract_json_block(content)
        if json_text:
            parsed = json.loads(json_text)
            return parsed
    except Exception as e:
        print("Workflow generation error:", e)

    # Fallback
    return {
        "nodes": [
            {
                "id": "n1",
                "type": "task",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": "Define requirements",
                    "description": "Break project into tasks",
                    "priority": "High",
                    "assigned_role": "Backend",
                    "source_requirement": "requirements"
                }
            },
            {
                "id": "n2",
                "type": "task",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": "Implement backend",
                    "description": "Build APIs and logic",
                    "priority": "High",
                    "assigned_role": "Backend",
                    "source_requirement": "system_behavior"
                }
            }
        ],
        "edges": [
            {
                "id": "e1",
                "source": "n1",
                "target": "n2"
            }
        ],
        "order": ["n1", "n2"]
    }


def gather_requirements(idea: str) -> dict:
    prompt = f"""
You are an expert Product Manager and Requirement Engineer.

Convert this project idea into structured, actionable requirements.

First, identify the DOMAIN (e.g., E-commerce, Social media, AI application, Management system).

Then, based on the domain, gather requirements by asking focused questions internally.

Output ONLY valid JSON in this format:

{{
  "title": "Brief project title",
  "domain": "Identified domain",
  "requirements": ["List of main features"],
  "user_actions": ["List of user actions"],
  "system_behavior": ["List of system responses"],
  "data_entities": ["List of data to store/process"],
  "priority_features": ["List of high-priority features"],
  "team": {{
    "size": 3,
    "roles": ["Frontend", "Backend", "Designer"]
  }}
}}

Project idea: {idea}
"""

    messages = [
        {
            "role": "system",
            "content": "You are a senior product manager. Output structured requirements only.",
        },
        {"role": "user", "content": prompt},
    ]

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.2,
            max_tokens=1000,
        )

        content = response.choices[0].message.content or ""
        json_text = _extract_json_block(content)
        if json_text:
            parsed = json.loads(json_text)
            return parsed
    except Exception as e:
        print("Requirements gathering error:", e)

    # Fallback
    return {
        "title": "Project",
        "domain": "General",
        "requirements": ["Basic features"],
        "user_actions": ["Perform actions"],
        "system_behavior": ["Respond accordingly"],
        "data_entities": ["Data storage"],
        "priority_features": ["Key features"],
        "team": {"size": 1, "roles": ["Developer"]}
    }


def _safe_priority(value: str) -> str:
    p = str(value or "").strip().title()
    if p in {"High", "Medium", "Low"}:
        return p
    return "Medium"


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _extract_json_block(text: str) -> str | None:
    cleaned = text.replace("```json", "").replace("```", "")
    start = cleaned.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escape = False

    for idx, ch in enumerate(cleaned[start:], start):
        if ch == '"' and not escape:
            in_string = not in_string
        if ch == "\\" and not escape:
            escape = True
            continue
        if escape:
            escape = False
            continue

        if in_string:
            continue

        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return cleaned[start : idx + 1]

    return None


def _fallback_tasks() -> list[dict[str, Any]]:
    nodes = MOCK_JSON.get("nodes", []) if isinstance(MOCK_JSON, dict) else []
    tasks = []
    for idx, node in enumerate(nodes[:5], start=1):
        data = node.get("data", {}) if isinstance(node, dict) else {}
        tasks.append(
            {
                "id": str(node.get("id") or f"n{idx}"),
                "label": _normalize_text(data.get("label") or node.get("label") or f"Task {idx}"),
                "description": _normalize_text(data.get("description") or node.get("description") or ""),
                "features": [str(v) for v in (data.get("features") or []) if v],
                "modules": [str(v) for v in (data.get("modules") or []) if v],
                "priority": _safe_priority(data.get("priority") or node.get("priority") or "Medium"),
            }
        )

    if tasks:
        return tasks

    return [
        {
            "id": "n1",
            "label": "Define requirements",
            "description": "Break project idea into implementable milestones",
            "features": ["Requirement mapping", "Scope baseline"],
            "modules": ["Planning", "Specification"],
            "priority": "High",
        },
        {
            "id": "n2",
            "label": "Implement core backend",
            "description": "Create APIs and persistence layer",
            "features": ["CRUD endpoints", "Data persistence"],
            "modules": ["FastAPI", "Database"],
            "priority": "High",
        },
        {
            "id": "n3",
            "label": "Build frontend views",
            "description": "Implement UI and interaction flow",
            "features": ["Workflow graph", "Detail panel"],
            "modules": ["React", "UI components"],
            "priority": "Medium",
        },
    ]


def _normalize_task(task: dict[str, Any], idx: int) -> dict[str, Any]:
    task_id = _normalize_text(task.get("id")) or f"n{idx + 1}"
    label = _normalize_text(task.get("label")) or f"Task {idx + 1}"
    description = _normalize_text(task.get("description"))
    features = task.get("features") if isinstance(task.get("features"), list) else []
    modules = task.get("modules") if isinstance(task.get("modules"), list) else []

    return {
        "id": task_id,
        "label": label,
        "description": description,
        "features": [str(v) for v in features if v],
        "modules": [str(v) for v in modules if v],
        "priority": _safe_priority(task.get("priority") or "Medium"),
    }


def _generate_tasks_with_gpt(project_description: str) -> list[dict[str, Any]]:
    if not client.api_key:
        return _fallback_tasks()

    prompt = f"""
You are a senior software architect.
Generate ONLY task definitions for this project idea.

Return ONLY valid JSON with this exact shape:
{{
  "tasks": [
    {{
      "id": "n1",
      "label": "...",
      "description": "...",
      "features": ["...", "..."],
      "modules": ["...", "..."],
      "priority": "High"
    }}
  ]
}}

Rules:
- Return 5 tasks maximum.
- Do not include edges, order, insights, graph, or explanation.
- Every task must include at least 2 features and 2 modules.
- Priorities must be one of: High, Medium, Low.
- Keep content practical and specific.

Project idea: {project_description}
"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You return compact, valid JSON only.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=550,
        )
        content = response.choices[0].message.content or ""
        json_text = _extract_json_block(content)
        if not json_text:
            return _fallback_tasks()

        parsed = json.loads(json_text)
        raw_tasks = parsed.get("tasks") if isinstance(parsed, dict) else None
        if not isinstance(raw_tasks, list) or len(raw_tasks) == 0:
            return _fallback_tasks()

        normalized = [_normalize_task(task, idx) for idx, task in enumerate(raw_tasks[:5])]
        return normalized if normalized else _fallback_tasks()
    except Exception as exc:
        print(f"TASK GENERATION FALLBACK: {exc}")
        return _fallback_tasks()


def _build_graph_from_tasks(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    normalized_tasks = [_normalize_task(task, idx) for idx, task in enumerate(tasks[:5])]
    if not normalized_tasks:
        normalized_tasks = _fallback_tasks()[:5]

    graph = nx.DiGraph()
    for task in normalized_tasks:
        graph.add_node(task["id"])

    # Deterministic DAG: chain backbone + optional skip edges for high-priority tasks.
    for idx in range(len(normalized_tasks) - 1):
        source = normalized_tasks[idx]["id"]
        target = normalized_tasks[idx + 1]["id"]
        graph.add_edge(source, target)

    for idx in range(len(normalized_tasks) - 2):
        source_task = normalized_tasks[idx]
        source = source_task["id"]
        target = normalized_tasks[idx + 2]["id"]
        if source_task["priority"] == "High":
            graph.add_edge(source, target)

    if not nx.is_directed_acyclic_graph(graph):
        graph = nx.DiGraph()
        for task in normalized_tasks:
            graph.add_node(task["id"])
        for idx in range(len(normalized_tasks) - 1):
            graph.add_edge(normalized_tasks[idx]["id"], normalized_tasks[idx + 1]["id"])

    order = list(nx.topological_sort(graph))

    nodes = []
    for task in normalized_tasks:
        nodes.append(
            {
                "id": task["id"],
                "type": "task",
                "position": {"x": 0, "y": 0},
                "data": {
                    "label": task["label"],
                    "description": task["description"],
                    "features": task["features"],
                    "modules": task["modules"],
                    "priority": task["priority"],
                    "parallel": False,
                    "is_critical": False,
                    "is_bottleneck": False,
                },
            }
        )

    edges = []
    for idx, (source, target) in enumerate(graph.edges(), start=1):
        edges.append(
            {
                "id": f"e-{source}-{target}-{idx}",
                "source": str(source),
                "target": str(target),
            }
        )

    return {"nodes": nodes, "edges": edges, "order": [str(node_id) for node_id in order]}


def _analyze_workflow(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    graph = nx.DiGraph()
    node_by_id: dict[str, dict[str, Any]] = {}

    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = _normalize_text(node.get("id"))
        if not node_id:
            continue
        node_by_id[node_id] = node
        graph.add_node(node_id)

    for edge in edges:
        if not isinstance(edge, dict):
            continue
        source = _normalize_text(edge.get("source") or edge.get("from"))
        target = _normalize_text(edge.get("target") or edge.get("to"))
        if not source or not target:
            continue
        if source not in node_by_id or target not in node_by_id:
            continue
        graph.add_edge(source, target)

    if graph.number_of_nodes() == 0:
        return {
            "critical_path": [],
            "top_bottlenecks": [],
            "parallel_groups": [],
            "start_task": "",
            "end_task": "",
            "explanation": "No tasks available for analysis.",
        }

    if not nx.is_directed_acyclic_graph(graph):
        raise ValueError("Workflow graph must be a DAG")

    order = list(nx.topological_sort(graph))
    critical_path = [str(node_id) for node_id in nx.dag_longest_path(graph)]

    degree_rank = sorted(
        graph.nodes(),
        key=lambda n: (graph.in_degree(n) + graph.out_degree(n), graph.out_degree(n), n),
        reverse=True,
    )
    top_bottlenecks = [str(node_id) for node_id in degree_rank[:3]]

    levels: dict[str, int] = {}
    for node_id in order:
        preds = list(graph.predecessors(node_id))
        levels[node_id] = 0 if not preds else max(levels[pred] for pred in preds) + 1

    grouped: dict[int, list[str]] = {}
    for node_id, level in levels.items():
        grouped.setdefault(level, []).append(str(node_id))
    parallel_groups = [grouped[level] for level in sorted(grouped.keys())]

    start_task_id = str(order[0]) if order else ""
    end_task_id = str(order[-1]) if order else ""

    start_task = node_by_id.get(start_task_id, {}).get("data", {}).get("label") or start_task_id
    end_task = node_by_id.get(end_task_id, {}).get("data", {}).get("label") or end_task_id

    explanation = (
        f"This workflow contains {len(order)} tasks. "
        f"Critical path length is {len(critical_path)}. "
        "Parallel groups show tasks that can run together."
    )

    critical_set = set(critical_path)
    bottleneck_set = set(top_bottlenecks)
    parallel_nodes = set(node_id for group in parallel_groups if len(group) > 1 for node_id in group)

    for node_id, node in node_by_id.items():
        data = node.get("data") if isinstance(node.get("data"), dict) else {}
        data["is_critical"] = node_id in critical_set
        data["is_bottleneck"] = node_id in bottleneck_set
        data["parallel"] = node_id in parallel_nodes
        node["data"] = data

    return {
        "critical_path": critical_path,
        "top_bottlenecks": top_bottlenecks,
        "parallel_groups": parallel_groups,
        "start_task": _normalize_text(start_task),
        "end_task": _normalize_text(end_task),
        "explanation": explanation,
    }


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "running"}


@app.post("/generate-tasks")
def generate_tasks(request: GenerateTasksRequest) -> dict[str, Any]:
    tasks = _generate_tasks_with_gpt(request.project_description)
    return {"tasks": tasks}


@app.post("/build-graph")
def build_graph(request: BuildGraphRequest) -> dict[str, Any]:
    tasks = [task.model_dump() for task in request.tasks]
    return _build_graph_from_tasks(tasks)


@app.post("/analyze-workflow")
def analyze_workflow(request: AnalyzeWorkflowRequest) -> dict[str, Any]:
    insights = _analyze_workflow(request.nodes, request.edges)
    return {"insights": insights}


@app.post("/gather-requirements")
def gather_requirements_endpoint(request: GatherRequirementsRequest) -> dict[str, Any]:
    return gather_requirements(request.project_idea)


@app.post("/generate-workflow")
def generate_workflow_endpoint(request: GenerateWorkflowRequest) -> dict[str, Any]:
    return generate_workflow_from_requirements(request.requirements)


@app.post("/generate-insights")
def generate_insights_endpoint(request: GenerateInsightsRequest) -> dict[str, Any]:
    data = {
        "nodes": request.nodes,
        "edges": request.edges,
        "order": request.order,
        "parallel_groups": request.parallel_groups,
        "critical_path": request.critical_path,
        "bottlenecks": request.bottlenecks
    }
    return generate_execution_insights(data)
