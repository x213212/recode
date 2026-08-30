#!/usr/bin/env python3
"""Derive RECODE display fields and materialize a staging bundle."""

from __future__ import annotations

import argparse
import ast
import json
from pathlib import Path


SUMMARY_FIELDS = (
    "id", "order", "identity", "title", "category", "difficulty",
    "sources", "testCount", "runnable",
)


def overlay_answer(code: str) -> str:
    """Return the import-free top-level class/function projection."""
    tree = ast.parse(code)
    executable = [
        node for node in tree.body
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    if not executable:
        raise ValueError("answer must define a top-level class or function")
    module = ast.Module(body=executable, type_ignores=[])
    ast.fix_missing_locations(module)
    unparsed = ast.unparse(module).strip()
    return "\n".join(line for line in unparsed.splitlines() if line.strip())


def starter(code: str) -> str:
    """Keep signatures while preserving overlay line alignment."""
    complete = overlay_answer(code)
    tree = ast.parse(complete)
    kept_lines: set[int] = set()

    def keep_signature(
        node: ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef,
    ) -> None:
        def statement_start(member: ast.stmt) -> int:
            decorators = getattr(member, "decorator_list", [])
            return min(
                [member.lineno, *(decorator.lineno for decorator in decorators)]
            )

        first_body_line = min(
            (statement_start(member) for member in node.body),
            default=node.end_lineno or node.lineno,
        )
        kept_lines.update(range(node.lineno, first_body_line))
        for decorator in node.decorator_list:
            kept_lines.update(
                range(decorator.lineno, (decorator.end_lineno or decorator.lineno) + 1)
            )

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            keep_signature(node)
            continue
        if not isinstance(node, ast.ClassDef):
            continue
        keep_signature(node)
        for member in node.body:
            if isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                keep_signature(member)

    return "\n".join(
        line if number in kept_lines else line[: len(line) - len(line.lstrip())]
        for number, line in enumerate(complete.splitlines(), 1)
    )


def summary(problem: dict[str, object]) -> dict[str, object]:
    return {field: problem[field] for field in SUMMARY_FIELDS}


def render_explanation(problem: dict[str, object]) -> str:
    sections = (
        ("1. 題目要你交付什麼", "goal"),
        ("從題目本身先確定的規則", "facts"),
        ("2. 先照直覺做，真正卡在哪裡", "friction"),
        ("3. 解法主幹是怎麼被逼出來的", "route"),
        ("程式執行時只保存必要狀態", "state"),
        ("用圖先固定最容易混亂的關係", "diagram"),
        ("4. 從必要決定逐步推出程式碼", "derivation"),
        ("5. 用測資完整走一遍", "trace"),
        ("6. 為什麼走完不會漏答案", "proof"),
        ("為什麼不是另一種常見寫法", "wrongAlternative"),
        ("7. 關掉答案後重新建構", "rebuild"),
    )
    body = [f"# {problem['identity']} {problem['title']}"]
    for title, field in sections:
        body.append(f"## {title}\n\n{problem[field]}")
    body.extend(
        [
            f"> [!IMPORTANT]\n> **最後才壓成一句：** {problem['memoryLine']}",
            f"## 解法前提\n\n{problem['premise']}",
            f"## 記憶卡\n\n{problem['memoryCard']}",
            f"## 獨立摘要\n\n{problem['standaloneSummary']}",
        ]
    )
    return "\n\n".join(str(part).strip() for part in body).strip() + "\n"


def materialize(draft: dict[str, object], output: Path, force: bool) -> None:
    problem = dict(draft)
    answer = str(problem.get("answer", "")).replace("\r\n", "\n").rstrip("\n")
    tests = problem.get("tests")
    if not answer.strip():
        raise ValueError("answer is required")
    if not isinstance(tests, list) or not tests:
        raise ValueError("at least one test is required")

    problem["answer"] = answer
    problem["overlayAnswer"] = overlay_answer(answer)
    problem["starter"] = starter(answer)
    problem["testCount"] = len(tests)
    problem["runnable"] = True

    output.mkdir(parents=True, exist_ok=True)
    targets = tuple(
        output / name
        for name in ("problem.json", "solution.py", "tests.json", "explanation.md")
    )
    existing = [path.name for path in targets if path.exists()]
    if existing and not force:
        raise FileExistsError(
            f"refusing to overwrite {', '.join(existing)}; pass --force after review"
        )

    (output / "problem.json").write_text(
        json.dumps(problem, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output / "solution.py").write_text(answer + "\n", encoding="utf-8")
    (output / "tests.json").write_text(
        json.dumps(tests, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output / "explanation.md").write_text(
        render_explanation(problem), encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("draft", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--force", action="store_true")
    arguments = parser.parse_args()
    draft = json.loads(arguments.draft.read_text(encoding="utf-8"))
    materialize(draft, arguments.output.resolve(), arguments.force)
    print(f"Materialized RECODE bundle: {arguments.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
