"""Test-only loaders: no main import, .env loading, camera, model or HTTP I/O."""
import ast
import importlib.util
from pathlib import Path
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "AIOT/edge"))  # Sibling modules; never import config/main.
MAIN_PATH = ROOT / "AIOT/edge/main.py"


def load_edge_module(filename, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "AIOT/edge" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


attendance = load_edge_module("attendance_service.py", "step01_attendance")


def unit_vector(score=1.0):
    """512D unit vector whose dot product with e0 is score (test fixture only)."""
    if not -1 <= score <= 1:
        raise ValueError("Fixture score must be within [-1,1]")
    vector = np.zeros(512, dtype=np.float64)
    vector[0], vector[1] = score, np.sqrt(1.0 - score * score)
    np.testing.assert_allclose(np.linalg.norm(vector), 1.0, atol=1e-12)
    return vector


def gallery_entry(code, score):
    return {"user_code": code, "full_name": f"Synthetic {code}", "embedding": unit_vector(score)}


def production_main_block(kind):
    """Compile the actual AST block, never copied/reimplemented business logic.

    Test boundaries are the refresh if-block and event-dispatch if-block. Top-level
    imports/config and the camera loop are NOT executed. Fail if source layout changes.
    """
    tree = ast.parse(MAIN_PATH.read_text(encoding="utf-8-sig"))
    main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "main")
    tests = {
        "refresh": "now - last_face_data_refresh >= config.FACE_DATA_REFRESH_SECONDS",
        "dispatch": "decision.should_send(user_code)",
    }
    found = [node for node in ast.walk(main) if isinstance(node, ast.If)
             and ast.unparse(node.test) == tests[kind]]
    if len(found) != 1:
        raise RuntimeError("Production block changed; review the reproduction fixture")
    body = [found[0]]
    if kind == "refresh":
        loader = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                      and node.name == "load_known_embeddings")
        body.insert(0, loader)
    return compile(ast.Module(body=body, type_ignores=[]), str(MAIN_PATH), "exec")


def production_gallery_startup():
    tree = ast.parse(MAIN_PATH.read_text(encoding="utf-8-sig"))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in ("load_known_embeddings", "initialize_member_gallery")]
    if len(functions) != 2:
        raise RuntimeError("Review changed production startup fixture")
    return compile(ast.Module(body=functions, type_ignores=[]), str(MAIN_PATH), "exec")
