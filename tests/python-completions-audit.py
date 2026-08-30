#!/usr/bin/env python3
"""Ensure every library symbol used by bundled answers is autocompletable."""

from __future__ import annotations

import ast
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROBLEMS = Path(
    os.environ.get("RECODE_SITE_DATA_OUTPUT", ROOT / "public" / "data")
).resolve() / "problems"
COMPLETIONS = ROOT / "lib" / "python-completions.json"
TRACKED_MODULES = {
    "bisect",
    "collections",
    "functools",
    "heapq",
    "math",
    "random",
    "typing",
}
MODULE_ATTRIBUTES = {"bisect", "heapq", "math", "random"}
PLATFORM_NAMES = {"ListNode", "Node", "TreeNode"}


def used_library_names() -> tuple[set[str], set[str]]:
    global_names = set(PLATFORM_NAMES)
    method_names: set[str] = set()

    for path in PROBLEMS.glob("*.json"):
        if path.name.startswith("._"):
            continue
        detail = json.loads(path.read_text(encoding="utf-8"))
        try:
            tree = ast.parse(detail.get("answer", ""))
        except SyntaxError:
            continue

        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root_module = alias.name.split(".", 1)[0]
                    if root_module in TRACKED_MODULES:
                        global_names.add(alias.asname or root_module)

            elif (
                isinstance(node, ast.ImportFrom)
                and node.module in TRACKED_MODULES
            ):
                for alias in node.names:
                    global_names.add(alias.asname or alias.name)

            elif (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id in MODULE_ATTRIBUTES
            ):
                method_names.add(node.attr)

    return global_names, method_names


def main() -> int:
    completions = json.loads(COMPLETIONS.read_text(encoding="utf-8"))
    global_labels = {
        item["label"] for item in completions if item["kind"] != "method"
    }
    method_labels = {
        item["label"] for item in completions if item["kind"] == "method"
    }
    used_globals, used_methods = used_library_names()

    missing_globals = sorted(used_globals - global_labels)
    missing_methods = sorted(used_methods - method_labels)
    if missing_globals or missing_methods:
        if missing_globals:
            print("缺少 library 名稱補全：" + ", ".join(missing_globals))
        if missing_methods:
            print("缺少 module method 補全：" + ", ".join(missing_methods))
        return 1

    print(
        "Python 補全審計通過："
        f"{len(used_globals)} 個題庫 library 名稱、"
        f"{len(used_methods)} 個 module method 全部涵蓋。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
