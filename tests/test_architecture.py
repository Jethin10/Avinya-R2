from __future__ import annotations

import ast
from pathlib import Path

import pytest
from pydantic import ValidationError

from engine.schemas import RawEvent


ROOT = Path(__file__).parents[1]


def test_core_never_imports_engine() -> None:
    violations: list[str] = []
    for path in (ROOT / "core").glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import) and any(name.name == "engine" or name.name.startswith("engine.") for name in node.names): violations.append(path.name)
            if isinstance(node, ast.ImportFrom) and node.module and (node.module == "engine" or node.module.startswith("engine.")): violations.append(path.name)
    assert violations == []


def test_runtime_contains_no_outbound_network_client() -> None:
    banned = {"requests", "httpx", "aiohttp", "urllib.request", "socket"}
    violations: list[str] = []
    for folder in ("core", "engine", "ingest", "exports"):
        for path in (ROOT / folder).glob("**/*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                module = node.module if isinstance(node, ast.ImportFrom) else None
                names = [name.name for name in node.names] if isinstance(node, ast.Import) else []
                if module in banned or any(name in banned for name in names): violations.append(str(path.relative_to(ROOT)))
    assert violations == []


def test_provenance_is_mandatory_at_the_ingest_boundary() -> None:
    with pytest.raises(ValidationError):
        RawEvent.model_validate({"kind": "report", "text": "damage reported"})

