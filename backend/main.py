import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import networkx as nx
import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db import get_db, init_db
from mock_data import MOCK_JSON
from models import Order, Project, Session as SessionModel, User
from security import create_access_token, get_current_user, hash_password, verify_password


load_dotenv()


def _allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
    origins = [v.strip() for v in raw.split(",") if v.strip()]
    return origins or ["http://127.0.0.1:5173"]


app = FastAPI(title="PROMAP API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


class SignupRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class GatherRequirementsRequest(BaseModel):
    description: str = ""
    project_idea: str = ""
    project_id: int | None = None
    previous_questions: list[str] | None = None


class SubmitRequirementsRequest(BaseModel):
    project_id: int
    answers: dict[str, Any]


class GenerateTasksRequest(BaseModel):
    project_id: int | None = None
    description: str
    requirements: dict[str, Any] | None = None
    project_description: str | None = None


class TaskItem(BaseModel):
    id: str
    label: str
    description: str
    phase: str
    features: list[str]
    modules: list[str]
    priority: str
    parallelizable: bool = False


class DependencyItem(BaseModel):
    source: str
    target: str


class BuildGraphRequest(BaseModel):
    project_id: int
    tasks: list[TaskItem] | None = None
    dependencies: list[DependencyItem] | None = None


class AnalyzeWorkflowRequest(BaseModel):
    project_id: int
    nodes: list[dict[str, Any]] | None = None
    edges: list[dict[str, Any]] | None = None


class CreateOrderRequest(BaseModel):
    order_number: str | None = None
    delivery_provider: str | None = None
    tracking_number: str | None = None
    tracking_url: str | None = None
    estimated_minutes: int | None = 180


class UpdateOrderStatusRequest(BaseModel):
    status: str


client = OpenAI(api_key=os.getenv("OPENAI_API_KEY", "").strip())

ORDER_STATUS_FLOW = ["ordered", "shipped", "out for delivery", "delivered"]


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_priority(value: str) -> str:
    p = str(value or "").strip().title()
    if p in {"High", "Medium", "Low"}:
        return p
    return "Medium"


def _safe_phase(value: str) -> str:
    phase = str(value or "").strip().title()
    allowed = {
        "Planning",
        "System Design",
        "Architecture",
        "Backend Development",
        "Frontend Development",
        "Integration",
        "Testing",
        "Deployment",
    }
    if phase in allowed:
        return phase
    if phase == "System Design / Architecture":
        return "Architecture"
    return "Planning"


ENGINEERING_PHASES = [
    "Planning",
    "Architecture",
    "Backend Development",
    "Frontend Development",
    "Integration",
    "Testing",
    "Deployment",
]


def _build_task_label(description: str, phase: str, fallback_label: str, index: int) -> str:
    text = _normalize_text(description)
    if text:
        return text
    return fallback_label or f"Task {index + 1}"


def _normalize_engineering_task(task: dict[str, Any], idx: int) -> dict[str, Any]:
    task_id = _normalize_text(task.get("id")) or f"n{idx + 1}"
    label = _normalize_text(task.get("label")) or f"Task {idx + 1}"
    description = _normalize_text(task.get("description"))
    phase = _safe_phase(task.get("phase") or ENGINEERING_PHASES[min(idx, len(ENGINEERING_PHASES) - 1)])
    priority = _safe_priority(task.get("priority") or "Medium")
    parallelizable = bool(task.get("parallelizable", False))
    features = task.get("features") if isinstance(task.get("features"), list) else []
    modules = task.get("modules") if isinstance(task.get("modules"), list) else []

    clean_features = [str(v) for v in features if _normalize_text(v)]
    clean_modules = [str(v) for v in modules if _normalize_text(v)]
    if len(clean_features) < 2:
        clean_features.extend(["Implementation", "Validation"])
    if len(clean_modules) < 2:
        clean_modules.extend(["Core", "Support"])

    return {
        "id": task_id,
        "label": label,
        "description": description,
        "phase": phase,
        "features": clean_features[:4],
        "modules": clean_modules[:4],
        "priority": priority,
        "parallelizable": parallelizable,
    }


def _normalize_dependency(dep: dict[str, Any], valid_ids: set[str]) -> dict[str, str] | None:
    if not isinstance(dep, dict):
        return None
    source = _normalize_text(dep.get("source") or dep.get("from"))
    target = _normalize_text(dep.get("target") or dep.get("to"))
    if not source or not target or source == target:
        return None
    if source not in valid_ids or target not in valid_ids:
        return None
    return {"source": source, "target": target}


def _fallback_engineering_workflow(description: str, requirements: dict[str, Any] | None = None) -> dict[str, Any]:
    label_hint = _normalize_text((requirements or {}).get("project_name") or description or "Project")
    tasks = [
        {
            "id": "n1",
            "label": f"Define {label_hint} scope and success criteria",
            "description": "Clarify goals, users, non-functional requirements, and delivery scope.",
            "phase": "Planning",
            "features": ["Requirements workshop", "Scope baseline"],
            "modules": ["Product discovery", "Acceptance criteria"],
            "priority": "High",
            "parallelizable": False,
        },
        {
            "id": "n2",
            "label": "Design system architecture and data model",
            "description": "Define service boundaries, data entities, and integration contracts.",
            "phase": "Architecture",
            "features": ["Domain modeling", "API contract planning"],
            "modules": ["Architecture", "Data modeling"],
            "priority": "High",
            "parallelizable": False,
        },
        {
            "id": "n3",
            "label": "Set up repo, CI, and environment baseline",
            "description": "Prepare repositories, CI pipelines, code quality checks, and local dev tooling.",
            "phase": "Planning",
            "features": ["Repository setup", "Continuous integration"],
            "modules": ["DevOps", "Tooling"],
            "priority": "Medium",
            "parallelizable": True,
        },
        {
            "id": "n4",
            "label": "Implement backend foundation and database schema",
            "description": "Create the backend skeleton, persistence layer, migrations, and shared services.",
            "phase": "Backend Development",
            "features": ["Database schema", "Service bootstrap"],
            "modules": ["FastAPI", "SQLAlchemy"],
            "priority": "High",
            "parallelizable": False,
        },
        {
            "id": "n5",
            "label": "Build authentication and authorization",
            "description": "Implement login, signup, session handling, and access control flows.",
            "phase": "Backend Development",
            "features": ["Auth flows", "Session management"],
            "modules": ["Auth service", "Security"],
            "priority": "High",
            "parallelizable": True,
        },
        {
            "id": "n6",
            "label": "Build core domain APIs",
            "description": "Implement primary business endpoints and domain rules for the product.",
            "phase": "Backend Development",
            "features": ["Core CRUD APIs", "Domain validation"],
            "modules": ["Business logic", "API layer"],
            "priority": "High",
            "parallelizable": True,
        },
        {
            "id": "n7",
            "label": "Build frontend shell and routing",
            "description": "Create the application shell, routing, and shared layout primitives.",
            "phase": "Frontend Development",
            "features": ["App shell", "Route structure"],
            "modules": ["React", "Routing"],
            "priority": "Medium",
            "parallelizable": True,
        },
        {
            "id": "n8",
            "label": "Build reusable UI components and design system",
            "description": "Define component patterns, tokens, and consistent interaction states.",
            "phase": "Frontend Development",
            "features": ["Design tokens", "Reusable components"],
            "modules": ["UI kit", "Styling"],
            "priority": "Medium",
            "parallelizable": True,
        },
        {
            "id": "n9",
            "label": "Implement primary user workflows",
            "description": "Build the feature screens and flows that depend on backend APIs.",
            "phase": "Frontend Development",
            "features": ["Primary workflows", "State management"],
            "modules": ["Views", "Client state"],
            "priority": "High",
            "parallelizable": True,
        },
        {
            "id": "n10",
            "label": "Integrate frontend and backend services",
            "description": "Wire UI actions to API endpoints and verify end-to-end data flow.",
            "phase": "Integration",
            "features": ["API integration", "End-to-end wiring"],
            "modules": ["Client API", "Backend integration"],
            "priority": "High",
            "parallelizable": False,
        },
        {
            "id": "n11",
            "label": "Execute automated testing and QA hardening",
            "description": "Add tests, validate edge cases, and stabilize the workflow under load.",
            "phase": "Testing",
            "features": ["Automated tests", "Regression checks"],
            "modules": ["Test suite", "Quality assurance"],
            "priority": "High",
            "parallelizable": False,
        },
        {
            "id": "n12",
            "label": "Deploy and add monitoring",
            "description": "Prepare release configuration, deployment, observability, and rollback steps.",
            "phase": "Deployment",
            "features": ["Release pipeline", "Monitoring"],
            "modules": ["Deployments", "Observability"],
            "priority": "High",
            "parallelizable": False,
        },
    ]

    dependencies = [
        {"source": "n1", "target": "n2"},
        {"source": "n1", "target": "n3"},
        {"source": "n2", "target": "n4"},
        {"source": "n3", "target": "n4"},
        {"source": "n4", "target": "n5"},
        {"source": "n4", "target": "n6"},
        {"source": "n2", "target": "n7"},
        {"source": "n3", "target": "n7"},
        {"source": "n7", "target": "n8"},
        {"source": "n5", "target": "n9"},
        {"source": "n6", "target": "n9"},
        {"source": "n8", "target": "n9"},
        {"source": "n5", "target": "n10"},
        {"source": "n6", "target": "n10"},
        {"source": "n9", "target": "n10"},
        {"source": "n10", "target": "n11"},
        {"source": "n8", "target": "n11"},
        {"source": "n11", "target": "n12"},
    ]

    return {"tasks": tasks, "dependencies": dependencies}


def _normalize_order_status(value: str) -> str:
    status_value = str(value or "").strip().lower()
    return status_value if status_value in ORDER_STATUS_FLOW else "ordered"


def _estimate_delivery_time(minutes: int | None = None) -> datetime:
    offset = max(int(minutes or 180), 15)
    return datetime.now(timezone.utc) + timedelta(minutes=offset)


def _next_order_status(current_status: str) -> str:
    current = _normalize_order_status(current_status)
    try:
        idx = ORDER_STATUS_FLOW.index(current)
    except ValueError:
        idx = 0
    return ORDER_STATUS_FLOW[min(idx + 1, len(ORDER_STATUS_FLOW) - 1)]


def _build_tracking_payload(order: Order) -> dict[str, Any]:
    estimated = order.estimated_delivery_time.isoformat() if order.estimated_delivery_time else None
    return {
        "id": order.id,
        "order_number": order.order_number,
        "status": order.status,
        "estimated_delivery_time": estimated,
        "delivery_provider": order.delivery_provider,
        "tracking_number": order.tracking_number,
        "tracking_url": order.tracking_url,
        "tracking_data": order.tracking_data or {},
        "last_synced_at": order.last_synced_at.isoformat() if order.last_synced_at else None,
        "status_history": (order.tracking_data or {}).get("status_history", []),
    }


async def _fetch_delivery_provider_tracking(order: Order) -> dict[str, Any] | None:
    base_url = os.getenv("DELIVERY_API_BASE_URL", "").strip()
    if not base_url or not order.tracking_number:
        return None

    api_key = os.getenv("DELIVERY_API_KEY", "").strip()
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    url = f"{base_url.rstrip('/')}/track/{order.tracking_number}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client_http:
            response = await client_http.get(url, headers=headers)
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict):
                return payload
    except Exception as exc:
        print("Delivery API sync fallback:", exc)

    return None


def _seed_status_history(order: Order) -> list[dict[str, Any]]:
    history = (order.tracking_data or {}).get("status_history") or []
    if history:
        return history

    created_at = datetime.now(timezone.utc).isoformat()
    return [{"status": "ordered", "timestamp": created_at}]


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


def _question_key(text: str, idx: int) -> str:
    ascii_text = (text or "").encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", ascii_text).strip("_").lower()
    return cleaned or f"q_{idx + 1}"


def _extract_questions(content: str) -> list[dict[str, str]]:
    if not content:
        return []

    json_text = _extract_json_block(content)
    if json_text:
        try:
            parsed = json.loads(json_text)
            arr = parsed.get("questions") if isinstance(parsed, dict) else None
            if isinstance(arr, list):
                structured: list[dict[str, str]] = []
                for idx, item in enumerate(arr):
                    if isinstance(item, str):
                        question = _normalize_text(item)
                        if not question:
                            continue
                        structured.append({"key": _question_key(question, idx), "question": question})
                        continue

                    if not isinstance(item, dict):
                        continue

                    question = _normalize_text(item.get("question"))
                    if not question:
                        continue

                    raw_key = _normalize_text(item.get("key"))
                    key = _question_key(raw_key or question, idx)
                    structured.append({"key": key, "question": question})

                return structured
        except Exception:
            pass

    return []


def _fallback_questions(description: str, previous_questions: list[str] | None = None) -> list[dict[str, str]]:
    text = description.lower()
    questions: list[str] = []
    previous = {q.strip().lower() for q in (previous_questions or []) if q}

    if "mobile" in text or "app" in text:
        questions.append("Which platforms should we target first: iOS, Android, or both?")
        questions.append("Do you prefer native development or a cross-platform stack like Flutter/React Native?")

    if "web" in text or "website" in text:
        questions.append("What frontend framework do you prefer, and is SEO a priority for public pages?")
        questions.append("What backend stack and database do you want for the web application?")

    if "payment" in text or "checkout" in text or "subscription" in text:
        questions.append("Which payment methods and providers should be supported at launch?")

    if "auth" in text or "login" in text or "sign" in text:
        questions.append("Which authentication methods are required: email/password, social login, SSO, or OTP?")

    questions.extend(
        [
            "Who are the primary users and what is the single most important success metric?",
            "Are there any compliance, privacy, or data residency requirements we must meet?",
            "What is your target launch timeline and MVP scope?",
            "Do you need integrations with existing systems or third-party APIs?",
        ]
    )

    unique: list[dict[str, str]] = []
    seen: set[str] = set()
    for q in questions:
        normalized_q = q.strip().lower()
        if normalized_q in previous:
            continue
        if normalized_q in seen:
            continue
        seen.add(normalized_q)
        unique.append({"key": _question_key(q, len(unique)), "question": q})

    if len(unique) < 5:
        variants = [
            "What are the must-have versus nice-to-have features for the first release?",
            "Are there any specific roles, permissions, or approval flows needed?",
            "Should this product integrate with any external services or APIs at launch?",
            "What are the main success metrics you will use to judge the MVP?",
            "Do you need audit logs, notifications, or analytics in the first version?",
        ]
        for candidate in variants:
            normalized_candidate = candidate.strip().lower()
            if normalized_candidate in previous:
                continue
            if normalized_candidate in seen:
                continue
            seen.add(normalized_candidate)
            unique.append({"key": _question_key(candidate, len(unique)), "question": candidate})
            if len(unique) >= 5:
                break

    return unique[:5]


def _generate_followup_questions(description: str, previous_questions: list[str] | None = None) -> list[dict[str, str]]:
    previous_questions = previous_questions or []
    if not client.api_key:
        return _fallback_questions(description, previous_questions)

    prompt = f"""
Generate 4-5 personalized follow-up questions for this software project description:
"{description}"

Previously asked questions to avoid repeating:
{json.dumps(previous_questions, ensure_ascii=False, indent=2)}

Rules:
- Questions must be directly relevant to the project.
- If mobile app is implied, ask platform and tech stack details.
- If web app is implied, ask frontend/backend framework details.
- If payment is implied, ask payment method/provider details.
- If authentication is implied, ask login/auth method details.
- Avoid repeating any previously asked questions.
- Prefer a new angle or a different implementation concern on each regeneration.
- Keep each question clear and concise.
- Output each question as an object with fields: key, question.
- key must be lowercase snake_case ascii.

Return JSON only:
{{
    "questions": [
        {{
            "key": "ui_features",
            "question": "What UI features should the app include?"
        }}
    ]
}}
"""
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You output valid JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=800,
        )
        content = response.choices[0].message.content or ""
        questions = _extract_questions(content)
        previous_lower = {p.strip().lower() for p in previous_questions if p}
        filtered: list[dict[str, str]] = []
        seen_now: set[str] = set()
        for item in questions:
            question_text = _normalize_text(item.get("question"))
            if not question_text:
                continue
            normalized_question = question_text.lower()
            if normalized_question in previous_lower:
                continue
            if normalized_question in seen_now:
                continue
            seen_now.add(normalized_question)
            filtered.append(
                {
                    "key": _question_key(item.get("key") or question_text, len(filtered)),
                    "question": question_text,
                }
            )

        if len(filtered) >= 4:
            return filtered[:5]
    except Exception as exc:
        print("Question generation fallback:", exc)

    return _fallback_questions(description, previous_questions)


def _fallback_tasks() -> list[dict[str, Any]]:
    return _fallback_engineering_workflow("", None)["tasks"]


def _generate_engineering_workflow_with_gpt(description: str, requirements: dict[str, Any]) -> dict[str, Any]:
    if not client.api_key:
        return _fallback_engineering_workflow(description, requirements)

    prompt = f"""
You are a senior software architect.

Given a project idea and requirements, generate a realistic engineering workflow.

RULES:
1. Break workflow into phases:
   - Planning
   - System Design / Architecture
   - Backend Development
   - Frontend Development
   - Integration
   - Testing
   - Deployment
2. Generate AT LEAST 10-15 tasks.
3. Each task must include:
   {{
     "id": "n1",
     "label": "...",
     "description": "...",
     "phase": "...",
     "priority": "High | Medium | Low",
     "parallelizable": true,
     "features": ["...", "..."],
     "modules": ["...", "..."]
   }}
4. DO NOT create a simple sequential chain.
5. Create REAL dependencies.
6. Also generate dependencies explicitly:
   {{
     "tasks": [...],
     "dependencies": [
       {{ "source": "n1", "target": "n3" }},
       {{ "source": "n1", "target": "n4" }}
     ]
   }}
7. Ensure workflow resembles real software development.

Return STRICT JSON ONLY.

Project idea:
{description}

Requirements:
{json.dumps(requirements, ensure_ascii=False, indent=2)}
"""
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You output strict JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.25,
            max_tokens=1800,
        )
        content = response.choices[0].message.content or ""
        print("RAW GPT:", content)
        json_text = _extract_json_block(content)
        if not json_text:
            print("WORKFLOW PARSE FAILED:", "No JSON block found")
            return _fallback_engineering_workflow(description, requirements)

        parsed = json.loads(json_text)
        raw_tasks = parsed.get("tasks") if isinstance(parsed, dict) else None
        raw_dependencies = parsed.get("dependencies") if isinstance(parsed, dict) else None
        if not isinstance(raw_tasks, list) or len(raw_tasks) < 10:
            print("WORKFLOW PARSE FAILED:", "Need at least 10 tasks")
            return _fallback_engineering_workflow(description, requirements)

        normalized_tasks = [_normalize_engineering_task(task, idx) for idx, task in enumerate(raw_tasks[:15])]
        valid_ids = {task["id"] for task in normalized_tasks}
        normalized_dependencies = [
            dep
            for dep in (
                _normalize_dependency(item, valid_ids)
                for item in (raw_dependencies if isinstance(raw_dependencies, list) else [])
            )
            if dep is not None
        ]
        if not normalized_dependencies:
            print("WORKFLOW PARSE FAILED:", "No valid dependencies")
            return _fallback_engineering_workflow(description, requirements)

        return {"tasks": normalized_tasks, "dependencies": normalized_dependencies}
    except Exception as exc:
        print("WORKFLOW PARSE FAILED:", exc)
        return _fallback_engineering_workflow(description, requirements)


def _compute_workflow_graph(tasks: list[dict[str, Any]], dependencies: list[dict[str, Any]]) -> dict[str, Any]:
    normalized_tasks = [_normalize_engineering_task(task, idx) for idx, task in enumerate(tasks)]
    if not normalized_tasks:
        fallback = _fallback_engineering_workflow("", None)
        normalized_tasks = fallback["tasks"]
        dependencies = fallback["dependencies"]

    node_map = {task["id"]: task for task in normalized_tasks}
    graph = nx.DiGraph()
    for task in normalized_tasks:
        graph.add_node(task["id"], **task)

    accepted_dependencies: list[dict[str, str]] = []
    seen_edges: set[tuple[str, str]] = set()
    for dep in dependencies:
        normalized_dep = _normalize_dependency(dep, set(node_map.keys()))
        if not normalized_dep:
            continue

        source = normalized_dep["source"]
        target = normalized_dep["target"]
        edge_key = (source, target)
        if edge_key in seen_edges:
            continue

        graph.add_edge(source, target)
        if nx.is_directed_acyclic_graph(graph):
            accepted_dependencies.append(normalized_dep)
            seen_edges.add(edge_key)
        else:
            graph.remove_edge(source, target)

    if graph.number_of_edges() == 0 and len(normalized_tasks) > 1:
        for idx in range(len(normalized_tasks) - 1):
            source = normalized_tasks[idx]["id"]
            target = normalized_tasks[idx + 1]["id"]
            graph.add_edge(source, target)
            if nx.is_directed_acyclic_graph(graph):
                accepted_dependencies.append({"source": source, "target": target})
            else:
                graph.remove_edge(source, target)

    if not nx.is_directed_acyclic_graph(graph):
        raise ValueError("Workflow graph must be a DAG")

    order = [str(node_id) for node_id in nx.topological_sort(graph)]
    parallel_groups = [list(group) for group in nx.topological_generations(graph)]
    critical_path = [str(node_id) for node_id in nx.dag_longest_path(graph)]
    bottlenecks = [
        str(node_id)
        for node_id in graph.nodes
        if (graph.in_degree(node_id) + graph.out_degree(node_id)) >= 3
    ]

    positions: dict[str, dict[str, int]] = {}
    for level, group in enumerate(parallel_groups):
        for index, node_id in enumerate(group):
                        positions[str(node_id)] = {"x": index * 300, "y": level * 150}

    critical_set = set(critical_path)
    bottleneck_set = set(bottlenecks)
    parallel_set = {node_id for group in parallel_groups if len(group) > 1 for node_id in group}

    nodes = []
    for node_id in order:
        task = dict(node_map[node_id])
        task["parallelizable"] = bool(task.get("parallelizable")) or node_id in parallel_set
        task["is_critical"] = node_id in critical_set
        task["is_bottleneck"] = node_id in bottleneck_set
        task["parallel"] = node_id in parallel_set
        nodes.append(
            {
                "id": node_id,
                "type": "task",
                "position": positions.get(node_id, {"x": 0, "y": 0}),
                "data": task,
            }
        )

    edges = [
        {
            "id": f"e-{dep['source']}-{dep['target']}-{idx}",
            "source": dep["source"],
            "target": dep["target"],
        }
        for idx, dep in enumerate(accepted_dependencies)
    ]

    start_task = nodes[0]["data"]["label"] if nodes else ""
    end_task = nodes[-1]["data"]["label"] if nodes else ""

    insights = {
        "critical_path": critical_path,
        "top_bottlenecks": bottlenecks,
        "parallel_groups": parallel_groups,
        "start_task": start_task,
        "end_task": end_task,
        "explanation": (
            f"Real DAG with {len(nodes)} tasks across {len(parallel_groups)} execution levels. "
            f"Critical path length is {len(critical_path)} and {len(parallel_groups)} parallel groups were detected."
        ),
    }

    return {
        "nodes": nodes,
        "edges": edges,
        "dependencies": accepted_dependencies,
        "order": order,
        "insights": insights,
        "critical_path_correct": True,
        "parallel_execution_enabled": any(len(group) > 1 for group in parallel_groups),
        "graph_structure": "DAG",
        "workflow_quality": "realistic",
    }


def _build_graph_from_tasks(tasks: list[dict[str, Any]], dependencies: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    dependencies = dependencies or []
    return _compute_workflow_graph(tasks, dependencies)


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
    bottleneck_candidates = [
        str(node_id)
        for node_id in graph.nodes
        if (graph.in_degree(node_id) + graph.out_degree(node_id)) >= 3
    ]
    top_bottlenecks = bottleneck_candidates[:3]
    parallel_groups = [list(group) for group in nx.topological_generations(graph)]

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
    parallel_nodes = {node_id for group in parallel_groups if len(group) > 1 for node_id in group}

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


def _ensure_project_owner(db: Session, project_id: int, user_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user_id).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _ensure_order_owner(db: Session, order_id: int, user_id: int) -> Order:
    order = db.query(Order).filter(Order.id == order_id, Order.user_id == user_id).first()
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


def _get_or_create_project(
    db: Session,
    user_id: int,
    description: str,
    requirements: dict[str, Any] | None,
    project_id: int | None = None,
) -> Project:
    if project_id:
        project = _ensure_project_owner(db, project_id, user_id)
        if description:
            project.description = description
        if requirements is not None:
            project.requirements = requirements
        db.commit()
        db.refresh(project)
        return project

    existing = db.query(Project).filter(Project.user_id == user_id, Project.description == description).all()
    requirements_json = json.dumps(requirements or {}, sort_keys=True)
    for project in existing:
        current_json = json.dumps(project.requirements or {}, sort_keys=True)
        if current_json == requirements_json:
            return project

    project = Project(
        user_id=user_id,
        description=description,
        requirements=requirements,
        tasks=None,
        graph=None,
        insights=None,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "running"}


@app.post("/signup")
def signup(payload: SignupRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    email = _normalize_text(payload.email).lower()
    if not email or len(payload.password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid signup payload")

    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(email=email, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    db.add(SessionModel(token=token, user_id=user.id))
    db.commit()

    return {
        "token": token,
        "user": {"id": user.id, "email": user.email},
    }


@app.post("/login")
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    email = _normalize_text(payload.email).lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_access_token(user.id)
    db.add(SessionModel(token=token, user_id=user.id))
    db.commit()

    return {
        "token": token,
        "user": {"id": user.id, "email": user.email},
    }


@app.post("/gather-requirements")
def gather_requirements(
    request: GatherRequirementsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    print("INPUT:", request.model_dump())
    description = _normalize_text(request.description or request.project_idea)
    if not description:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Description is required")

    project = _get_or_create_project(db, current_user.id, description, None, request.project_id)
    questions = _generate_followup_questions(description, request.previous_questions)
    result = {
        "project_id": project.id,
        "questions": questions,
    }

    print("OUTPUT:", result)
    return result


@app.post("/submit-requirements")
def submit_requirements(
    request: SubmitRequirementsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    print("INPUT:", request.model_dump())
    project = _ensure_project_owner(db, request.project_id, current_user.id)
    project.requirements = request.answers
    db.commit()
    db.refresh(project)
    result = {"project_id": project.id, "saved": True}
    print("OUTPUT:", result)
    return result


@app.post("/generate-tasks")
def generate_tasks(
    request: GenerateTasksRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    print("INPUT:", request.model_dump())
    description = _normalize_text(request.description or request.project_description)
    if not description:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Description is required")

    project = None
    if request.project_id:
        project = _ensure_project_owner(db, request.project_id, current_user.id)

    requirements = (project.requirements if project and project.requirements else None) or request.requirements or {}
    print("REQ:", requirements)
    project = _get_or_create_project(db, current_user.id, description, requirements, request.project_id)

    if project.tasks and project.graph and project.graph.get("dependencies"):
        result = {
            "project_id": project.id,
            "cached": True,
            "tasks": project.tasks,
            "dependencies": project.graph.get("dependencies", []),
        }
        print("OUTPUT:", result)
        return result

    workflow_seed = _generate_engineering_workflow_with_gpt(description, requirements)
    tasks = workflow_seed["tasks"]
    dependencies = workflow_seed["dependencies"]
    project.tasks = tasks
    project.graph = {"dependencies": dependencies}
    if not project.requirements:
        project.requirements = requirements
    db.commit()

    result = {
        "project_id": project.id,
        "cached": False,
        "tasks": tasks,
        "dependencies": dependencies,
    }

    print("OUTPUT:", result)
    return result


@app.post("/build-graph")
def build_graph(
    request: BuildGraphRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    print("INPUT:", request.model_dump())
    project = _ensure_project_owner(db, request.project_id, current_user.id)

    if project.graph and project.graph.get("nodes") and not request.tasks and not request.dependencies:
        result = {"project_id": project.id, "cached": True, **(project.graph or {})}
        print("NODES:", result.get("nodes", []))
        print("EDGES:", result.get("edges", []))
        print("OUTPUT:", result)
        return result

    if request.tasks:
        tasks = [task.model_dump() for task in request.tasks]
    else:
        tasks = project.tasks or []

    if not tasks:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tasks are required")

    print("BUILD GRAPH TASKS:", tasks)

    task_dependencies = [dependency.model_dump() for dependency in request.dependencies] if request.dependencies else []
    stored_dependencies = []
    if not task_dependencies:
        existing_graph = project.graph or {}
        stored_dependencies = existing_graph.get("dependencies", []) if isinstance(existing_graph, dict) else []

    graph_payload = _build_graph_from_tasks(tasks, task_dependencies or stored_dependencies)
    project.tasks = tasks
    project.graph = graph_payload
    project.insights = graph_payload.get("insights", {})
    db.commit()

    result = {"project_id": project.id, "cached": False, **graph_payload}
    print("NODES:", result.get("nodes", []))
    print("EDGES:", result.get("edges", []))
    print("OUTPUT:", result)
    return result


@app.post("/analyze-workflow")
def analyze_workflow(
    request: AnalyzeWorkflowRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    print("INPUT:", request.model_dump())
    project = _ensure_project_owner(db, request.project_id, current_user.id)

    if project.insights and not request.nodes and not request.edges:
        result = {
            "project_id": project.id,
            "cached": True,
            "insights": project.insights,
        }
        print("INSIGHTS:", result.get("insights", {}))
        print("OUTPUT:", result)
        return result

    graph_payload = project.graph or {}
    nodes = request.nodes if request.nodes is not None else graph_payload.get("nodes", [])
    edges = request.edges if request.edges is not None else graph_payload.get("edges", [])

    if not nodes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nodes are required")

    print("NODES:", nodes)
    print("EDGES:", edges)
    insights = _analyze_workflow(nodes, edges)
    print("INSIGHTS:", insights)
    project.insights = insights

    updated_graph = project.graph or {}
    updated_graph["nodes"] = nodes
    updated_graph["edges"] = edges
    project.graph = updated_graph
    db.commit()

    result = {"project_id": project.id, "cached": False, "insights": insights}

    print("OUTPUT:", result)
    return result


@app.get("/projects/{project_id}")
def get_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    project = _ensure_project_owner(db, project_id, current_user.id)
    return {
        "id": project.id,
        "description": project.description,
        "requirements": project.requirements or {},
        "tasks": project.tasks or [],
        "graph": project.graph or {},
        "insights": project.insights or {},
    }


@app.get("/projects")
def list_projects(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    projects = (
        db.query(Project)
        .filter(Project.user_id == current_user.id)
        .order_by(Project.id.desc())
        .all()
    )

    return [
        {
            "id": project.id,
            "description": project.description,
            "project_name": (project.requirements or {}).get("project_name") or project.description,
            "requirements": project.requirements or {},
            "has_graph": bool(project.graph and project.graph.get("nodes")),
            "has_insights": bool(project.insights),
            "node_count": len((project.graph or {}).get("nodes", []) or []),
        }
        for project in projects
    ]


@app.post("/orders")
def create_order(
    request: CreateOrderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order_number = _normalize_text(request.order_number) or f"ORD-{current_user.id}-{int(datetime.now(timezone.utc).timestamp())}"
    existing = db.query(Order).filter(Order.order_number == order_number, Order.user_id == current_user.id).first()
    if existing:
        return _build_tracking_payload(existing)

    order = Order(
        user_id=current_user.id,
        order_number=order_number,
        status="ordered",
        estimated_delivery_time=_estimate_delivery_time(request.estimated_minutes),
        delivery_provider=_normalize_text(request.delivery_provider) or "Delivery API",
        tracking_number=_normalize_text(request.tracking_number) or order_number,
        tracking_url=_normalize_text(request.tracking_url) or None,
        tracking_data={"status_history": [{"status": "ordered", "timestamp": datetime.now(timezone.utc).isoformat()}]},
        last_synced_at=datetime.now(timezone.utc),
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return _build_tracking_payload(order)


@app.get("/orders")
def list_orders(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    orders = db.query(Order).filter(Order.user_id == current_user.id).order_by(Order.id.desc()).all()
    if not orders:
        order = Order(
            user_id=current_user.id,
            order_number=f"ORD-{current_user.id}-1001",
            status="ordered",
            estimated_delivery_time=_estimate_delivery_time(180),
            delivery_provider="Delivery API",
            tracking_number=f"TRK-{current_user.id}-1001",
            tracking_data={"status_history": [{"status": "ordered", "timestamp": datetime.now(timezone.utc).isoformat()}]},
            last_synced_at=datetime.now(timezone.utc),
        )
        db.add(order)
        db.commit()
        db.refresh(order)
        orders = [order]

    return [_build_tracking_payload(order) for order in orders]


@app.get("/orders/{order_id}/tracking")
async def get_order_tracking(
    order_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order = _ensure_order_owner(db, order_id, current_user.id)

    provider_payload = await _fetch_delivery_provider_tracking(order)
    now = datetime.now(timezone.utc)

    if provider_payload and isinstance(provider_payload, dict):
        status_value = _normalize_order_status(provider_payload.get("status") or provider_payload.get("current_status") or order.status)
        history = provider_payload.get("status_history")
        if not isinstance(history, list) or not history:
            history = _seed_status_history(order)

        order.status = status_value
        if provider_payload.get("estimated_delivery_time"):
            try:
                order.estimated_delivery_time = datetime.fromisoformat(str(provider_payload["estimated_delivery_time"]))
            except Exception:
                pass
        order.tracking_data = {
            **(order.tracking_data or {}),
            "provider": provider_payload,
            "status_history": history,
        }
    else:
        history = _seed_status_history(order)
        if order.status != "delivered":
            order.status = _next_order_status(order.status)
            history.append({"status": order.status, "timestamp": now.isoformat()})
            order.tracking_data = {**(order.tracking_data or {}), "status_history": history}

    order.last_synced_at = now
    if not order.estimated_delivery_time:
        order.estimated_delivery_time = _estimate_delivery_time(180)
    db.commit()
    db.refresh(order)
    return _build_tracking_payload(order)


@app.post("/orders/{order_id}/status")
def update_order_status(
    order_id: int,
    request: UpdateOrderStatusRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    order = _ensure_order_owner(db, order_id, current_user.id)
    status_value = _normalize_order_status(request.status)
    order.status = status_value
    history = _seed_status_history(order)
    history.append({"status": status_value, "timestamp": datetime.now(timezone.utc).isoformat()})
    order.tracking_data = {**(order.tracking_data or {}), "status_history": history}
    order.last_synced_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(order)
    return _build_tracking_payload(order)
