#!/usr/bin/env python3
"""Keep RECODE's internal solution state quick to say and type."""

from __future__ import annotations

import ast
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROBLEMS = Path(
    os.environ.get("RECODE_SITE_DATA_OUTPUT", ROOT / "public" / "data")
).resolve() / "problems"
MAX_INTERNAL_NAME = 14
errors: list[str] = []

for path in sorted(PROBLEMS.glob("*.json")):
    if path.name.startswith("._"):
        continue
    detail = json.loads(path.read_text(encoding="utf-8"))
    tree = ast.parse(detail["overlayAnswer"])
    parameters = {
        argument.arg
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        for argument in (
            *node.args.posonlyargs,
            *node.args.args,
            *node.args.kwonlyargs,
        )
    }
    local_names = {
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name) and node.id not in parameters
    }
    too_long = sorted(
        name for name in local_names if len(name) > MAX_INTERNAL_NAME
    )
    if too_long:
        errors.append(f"{path.stem}: {', '.join(too_long)}")

if errors:
    raise SystemExit(
        "RECODE 解答仍有不利快速輸入的長變數：\n" + "\n".join(errors)
    )

print(f"解答命名審計通過：內部狀態名稱皆不超過 {MAX_INTERNAL_NAME} 字元。")
