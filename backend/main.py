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
    features: list[str]
    modules: list[str]
    priority: str


class BuildGraphRequest(BaseModel):
    project_id: int
    tasks: list[TaskItem] | None = None


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
        if len(tasks) >= 3:
            return tasks[:5]

        while len(tasks) < 3:
            next_index = len(tasks) + 1
            tasks.append(
                {
                    "id": f"n{next_index}",
                    "label": f"Fallback Task {next_index}",
                    "description": "Fallback task used when GPT output cannot be parsed.",
                    "features": ["Implementation", "Validation"],
                    "modules": ["Core", "Support"],
                    "priority": "Medium",
                }
            )
        return tasks

    return [
        {
            "id": "n1",
            "label": "Define scope and architecture",
            "description": "Convert requirements into implementation-ready scope",
            "features": ["Scope definition", "Architecture decisions"],
            "modules": ["Planning", "Architecture"],
            "priority": "High",
        },
        {
            "id": "n2",
            "label": "Implement backend services",
            "description": "Build APIs and persistence for core use cases",
            "features": ["API routes", "Database integration"],
            "modules": ["FastAPI", "SQLAlchemy"],
            "priority": "High",
        },
        {
            "id": "n3",
            "label": "Build frontend workflow UI",
            "description": "Create user flow and workflow visualization",
            "features": ["Onboarding UI", "Graph rendering"],
            "modules": ["React", "React Flow"],
            "priority": "Medium",
        },
    ]


def _normalize_task(task: dict[str, Any], idx: int) -> dict[str, Any]:
    task_id = _normalize_text(task.get("id")) or f"n{idx + 1}"
    label = _normalize_text(task.get("label")) or f"Task {idx + 1}"
    description = _normalize_text(task.get("description"))
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
        "features": clean_features[:4],
        "modules": clean_modules[:4],
        "priority": _safe_priority(task.get("priority") or "Medium"),
    }


def _generate_tasks_with_gpt(description: str, requirements: dict[str, Any]) -> list[dict[str, Any]]:
    if not client.api_key:
        return _fallback_tasks()

    prompt = f"""
You are a senior software architect.
Generate ONLY task definitions for this project.

Description: {description}
User Requirements:
{json.dumps(requirements, ensure_ascii=False, indent=2)}

Return ONLY JSON:
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
- Return max 5 tasks.
- Every task must have at least 2 features and 2 modules.
- Priority must be High, Medium, or Low.
- No graph, no edges, no explanations.
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
        print("RAW GPT:", content)
        json_text = _extract_json_block(content)
        if not json_text:
            print("TASK PARSE FAILED:", "No JSON block found")
            return _fallback_tasks()

        parsed = json.loads(json_text)
        raw_tasks = parsed.get("tasks") if isinstance(parsed, dict) else None
        if not isinstance(raw_tasks, list) or not raw_tasks:
            print("TASK PARSE FAILED:", "Missing tasks array")
            return _fallback_tasks()

        normalized = [_normalize_task(task, idx) for idx, task in enumerate(raw_tasks[:5])]
        return normalized if normalized else _fallback_tasks()
    except Exception as exc:
        print("TASK PARSE FAILED:", exc)
        return _fallback_tasks()


def _build_graph_from_tasks(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    normalized_tasks = [_normalize_task(task, idx) for idx, task in enumerate(tasks[:5])]
    if not normalized_tasks:
        normalized_tasks = _fallback_tasks()[:5]

    while len(normalized_tasks) < 3:
        fallback_tasks = _fallback_tasks()
        missing_index = len(normalized_tasks)
        normalized_tasks.append(fallback_tasks[missing_index])

    graph = nx.DiGraph()
    for task in normalized_tasks:
        graph.add_node(task["id"])

    for idx in range(len(normalized_tasks) - 1):
        source = normalized_tasks[idx]["id"]
        target = normalized_tasks[idx + 1]["id"]
        graph.add_edge(source, target)

    order = [str(node_id) for node_id in nx.topological_sort(graph)]
    nodes = [
        {
            "id": task["id"],
            "type": "task",
            "position": {"x": 0, "y": 0},
            "data": task,
        }
        for task in normalized_tasks
    ]
    edges = [
        {
            "id": f"e{idx}",
            "source": str(source),
            "target": str(target),
        }
        for idx, (source, target) in enumerate(graph.edges())
    ]
    return {"nodes": nodes, "edges": edges, "order": order}


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

    if project.tasks:
        result = {
            "project_id": project.id,
            "cached": True,
            "tasks": project.tasks,
        }
        print("OUTPUT:", result)
        return result

    tasks = _generate_tasks_with_gpt(description, requirements)
    project.tasks = tasks
    if not project.requirements:
        project.requirements = requirements
    db.commit()

    result = {
        "project_id": project.id,
        "cached": False,
        "tasks": tasks,
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

    if project.graph and not request.tasks:
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

    graph_payload = _build_graph_from_tasks(tasks)
    project.tasks = tasks
    project.graph = graph_payload
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

    result = {
        "project_id": project.id,
        "cached": False,
        "insights": insights,
    }

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
