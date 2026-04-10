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
    "explanation": "Fallback workflow used due to AI failure.",
}
