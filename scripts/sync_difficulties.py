#!/usr/bin/env python3
"""Build the local difficulty override table for workbook chapters missing it."""

from __future__ import annotations

import json
from pathlib import Path
import re
from urllib.request import Request, urlopen


SITE_ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = SITE_ROOT / "public" / "data" / "index.json"
OUTPUT_PATH = SITE_ROOT / "scripts" / "difficulty_overrides.json"
LCOF_METADATA_PATH = (
    SITE_ROOT.parent
    / "interview_review_books"
    / "sources"
    / "doocs-leetcode"
    / "lcof"
    / "lcof.json"
)

LEVELS = {1: "easy", 2: "medium", 3: "hard"}
TEXT_LEVELS = {"Easy": "easy", "Medium": "medium", "Hard": "hard"}

# This workbook-only skyline variant has no official LeetCode difficulty.
# It combines a sweep line, event grouping, Counter and lazy heap deletion.
INFERRED_DIFFICULTIES = {"lcof-extra-01": "hard"}


def normalized_offer_id(value: str) -> str:
    return (
        value.lower()
        .replace("面试题", "")
        .replace("offer", "")
        .replace(" ", "")
        .replace("-", "")
        .replace("i", "1")
    )


def official_leetcode_difficulties() -> dict[str, str]:
    request = Request(
        "https://leetcode.com/api/problems/all/",
        headers={"User-Agent": "recode-local-difficulty-sync/1.0"},
    )
    with urlopen(request, timeout=30) as response:
        payload = json.load(response)

    return {
        f"lc-{item['stat']['frontend_question_id']}": LEVELS[
            item["difficulty"]["level"]
        ]
        for item in payload["stat_status_pairs"]
    }


def offer_difficulties() -> dict[str, str]:
    metadata = json.loads(LCOF_METADATA_PATH.read_text(encoding="utf-8"))
    return {
        normalized_offer_id(item["frontend_id"]): TEXT_LEVELS[
            item["difficulty"]
        ]
        for item in metadata
    }


def main() -> None:
    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    existing_overrides = (
        json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
        if OUTPUT_PATH.exists()
        else {}
    )
    targets = [
        problem
        for problem in index["problems"]
        if problem["difficulty"] == "unknown"
        or problem["id"] in existing_overrides
    ]
    official = official_leetcode_difficulties()
    offers = offer_difficulties()
    overrides: dict[str, str] = {}
    unresolved: list[str] = []

    for problem in targets:
        problem_id = problem["id"]
        difficulty = official.get(problem_id)

        if difficulty is None and problem_id.startswith("lcof-"):
            difficulty = offers.get(
                normalized_offer_id(problem["identity"])
            )

        if difficulty is None:
            difficulty = INFERRED_DIFFICULTIES.get(problem_id)

        if difficulty is None:
            unresolved.append(
                f"{problem_id} {problem['identity']} {problem['title']}"
            )
            continue

        overrides[problem_id] = difficulty

    if unresolved:
        raise RuntimeError(
            "仍有難度無法判定：\n" + "\n".join(unresolved)
        )

    ordered = dict(
        sorted(
            overrides.items(),
            key=lambda item: (
                int(re.search(r"\d+", item[0]).group()),
                item[0],
            ),
        )
    )
    OUTPUT_PATH.write_text(
        json.dumps(ordered, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    counts = {
        level: sum(value == level for value in ordered.values())
        for level in ("easy", "medium", "hard")
    }
    print(
        f"已補齊 {len(ordered)} 題難度："
        f"簡單 {counts['easy']}、"
        f"中等 {counts['medium']}、"
        f"困難 {counts['hard']}。"
    )


if __name__ == "__main__":
    main()
