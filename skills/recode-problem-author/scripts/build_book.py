#!/usr/bin/env python3
"""Build an ordered Markdown book from validated RECODE problem data."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile

from derive_problem_fields import render_explanation


def heading_depth(markdown: str, extra: int = 2) -> str:
    result = []
    for line in markdown.splitlines():
        match = re.match(r"^(#{1,6})(\s+.*)$", line)
        if match:
            depth = min(6, len(match.group(1)) + extra)
            line = "#" * depth + match.group(2)
        result.append(line)
    return "\n".join(result)


def safe_anchor(value: str) -> str:
    slug = re.sub(r"[^a-z0-9_-]+", "-", value.lower()).strip("-")
    return slug or "section"


def selected_statement(problem: dict[str, object], locale: str) -> tuple[str, str]:
    if locale == "en":
        english = str(problem.get("statementEn", "")).strip()
        body = re.sub(r"^\*\*English title:\*\*[^\n]*", "", english).strip()
        if len(body) >= 100:
            return english, "English"
        return str(problem["statementZh"]), "繁中 fallback（英文正文尚未完成）"
    return str(problem["statementZh"]), "繁體中文"


def render_problem(problem: dict[str, object], locale: str) -> str:
    statement, language_label = selected_statement(problem, locale)
    sources = " / ".join(str(value) for value in problem["sources"])
    tests = []
    for test in problem["tests"]:
        tests.append(
            f"#### {test['name']}\n\n"
            f"```text\nInput: {test['input']}\nExpected: {test['expected']}\n```"
        )
    explanation = heading_depth(render_explanation(problem), extra=2)
    return "\n\n".join(
        [
            f"<a id=\"problem-{safe_anchor(str(problem['id']))}\"></a>",
            f"## {problem['identity']} · {problem['title']}",
            f"**Difficulty:** {problem['difficulty']}  \n**Sources:** {sources}",
            f"### Problem · {language_label}\n\n{statement}",
            f"### Structured explanation\n\n{explanation}",
            "### solution.py\n\n```python\n" + str(problem["answer"]).rstrip() + "\n```",
            "### Executable examples\n\n" + "\n\n".join(tests),
            '<div class="page-break"></div>',
        ]
    )


def build_book(data_root: Path, output: Path, locale: str, title: str) -> int:
    index = json.loads((data_root / "index.json").read_text(encoding="utf-8"))
    summaries = sorted(index["problems"], key=lambda item: int(item["order"]))
    details: list[dict[str, object]] = []
    for summary in summaries:
        problem_id = str(summary["id"])
        if problem_id.startswith("._") or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", problem_id):
            raise ValueError(f"unsafe problem id in index: {problem_id}")
        path = data_root / "problems" / f"{problem_id}.json"
        detail = json.loads(path.read_text(encoding="utf-8"))
        if str(detail.get("id")) != problem_id:
            raise ValueError(f"index/detail id mismatch: {problem_id}")
        details.append(detail)

    categories: list[str] = []
    for problem in details:
        category = str(problem["category"])
        if category not in categories:
            categories.append(category)

    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    parts = [
        f"# {title}",
        (
            f"Locale: `{locale}`  \nGenerated: `{generated}`  \n"
            f"Problems: `{len(details)}`\n\n"
            "> Problem statements and source-list names may be third-party material. "
            "Verify redistribution rights before publishing this generated book."
        ),
        "## Table of contents",
    ]
    for category_index, category in enumerate(categories, 1):
        anchor = f"category-{category_index}"
        parts.append(f"- [{category}](#{anchor})")
        for problem in (item for item in details if item["category"] == category):
            parts.append(
                f"  - [{problem['identity']} · {problem['title']}]"
                f"(#problem-{safe_anchor(str(problem['id']))})"
            )

    for category_index, category in enumerate(categories, 1):
        parts.append(f'<a id="category-{category_index}"></a>\n\n# {category}')
        for problem in (item for item in details if item["category"] == category):
            parts.append(render_problem(problem, locale))

    content = "\n\n".join(parts).rstrip() + "\n"
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.name}.", suffix=".tmp", dir=output.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, output)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise
    return len(details)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--locale", choices=("zh-TW", "en"), default="zh-TW")
    parser.add_argument("--title", default="RECODE Algorithm Recall Book")
    arguments = parser.parse_args()
    count = build_book(
        arguments.data_root.resolve(), arguments.output.resolve(),
        arguments.locale, arguments.title,
    )
    print(f"Generated Markdown book with {count} problems: {arguments.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
