MOCK_JSON = {
    "nodes": [
        {
            "id": "n1",
            "type": "task",
            "position": {"x": 100, "y": 100},
            "data": {
                "label": "Setup Database",
                "description": "Create schema",
                "priority": "Medium",
                "features": ["Schema design", "Migration setup"],
                "modules": ["Database", "Migration runner"],
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
                "priority": "High",
                "features": ["REST APIs", "Validation layer"],
                "modules": ["FastAPI", "Business logic"],
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
    "critical_path": ["n1", "n2"],
    "parallel_groups": [["n1"], ["n2"]],
    "bottlenecks": ["n2"],
    "explanation": "Fallback workflow used due to AI failure.",
    "insights": {
        "critical_path": ["n1", "n2"],
        "top_bottlenecks": ["n2"],
        "parallel_groups": [["n1"], ["n2"]],
        "start_task": "Setup Database",
        "end_task": "Build Backend",
        "explanation": "Fallback workflow used due to AI failure.",
    },
}
