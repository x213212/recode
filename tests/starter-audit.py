#!/usr/bin/env python3
"""Parse every answer and starter without executing user algorithms."""

from __future__ import annotations

import ast
import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(
    os.environ.get("RECODE_SITE_DATA_OUTPUT", ROOT / "public" / "data")
).resolve()
failures = []
count = 0

for path in (DATA_ROOT / "problems").glob("*.json"):
    if path.name.startswith("._"):
        continue
    detail = json.loads(path.read_text(encoding="utf-8"))
    count += 1
    for field in ("answer",):
        try:
            ast.parse(detail[field])
        except SyntaxError as error:
            failures.append(f"{detail['id']} {field}: {error}")

    starter_lines = detail["starter"].splitlines()
    repaired = list(starter_lines)
    for index, line in enumerate(starter_lines[:-1]):
        if line.lstrip().startswith(("def ", "async def ")) and line.rstrip().endswith(":"):
            if not starter_lines[index + 1].strip():
                indentation = len(line) - len(line.lstrip()) + 4
                repaired[index + 1] = " " * indentation + "pass"
    try:
        ast.parse("\n".join(repaired))
    except SyntaxError as error:
        failures.append(f"{detail['id']} starter: {error}")

if failures:
    print("\n".join(failures[:50]), file=sys.stderr)
    raise SystemExit(1)

print(f"骨架審計通過：{count} 題都有可還原的空白函式骨架。")
