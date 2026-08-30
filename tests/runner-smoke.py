#!/usr/bin/env python3
"""Small, bounded smoke test for representative runner input shapes."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import traceback


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = Path(
    os.environ.get("RECODE_SITE_DATA_OUTPUT", ROOT / "public" / "data")
).resolve()
source = (ROOT / "public" / "runner.py").read_text(encoding="utf-8")
source = source.rsplit("\nmain()", 1)[0]
namespace: dict = {}
exec(compile(source, "runner.py", "exec"), namespace)
run_one = namespace["run_one"]

# Keep this list deliberately small. Never bulk-execute the complete workbook:
# malformed extracted examples may drive an otherwise valid algorithm into an
# unbounded state. Browser execution is isolated in a disposable Web Worker.
SMOKE_IDS = ("lc-1", "lc-215", "lc-347", "lc-2300", "lc-901", "lc-146")


def verify_solution_line_numbers() -> None:
    test = {
        "name": "錯誤行定位",
        "input": "nums = [1], target = 1",
        "expected": "[]",
    }

    syntax_code = "\n".join(
        [
            "class Solution:",
            "    def twoSum(self, nums, target):",
            "        value = 1",
            "        return (",
        ]
    )
    try:
        run_one(syntax_code, test, False)
        raise AssertionError("語法錯誤測資沒有拋出 SyntaxError")
    except SyntaxError as error:
        assert error.filename == "<solution>"
        assert error.lineno == 4

    runtime_code = "\n".join(
        [
            "class Solution:",
            "    def twoSum(self, nums, target):",
            "        value = nums[5]",
            "        return value",
        ]
    )
    try:
        run_one(runtime_code, test, False)
        raise AssertionError("執行錯誤測資沒有拋出 IndexError")
    except IndexError as error:
        frames = traceback.extract_tb(error.__traceback__)
        solution_frames = [
            frame for frame in frames if frame.filename == "<solution>"
        ]
        assert solution_frames
        assert solution_frames[-1].lineno == 3


def main() -> int:
    verify_solution_line_numbers()
    failures = []
    checked_cases = 0
    for problem_id in SMOKE_IDS:
        path = DATA_ROOT / "problems" / f"{problem_id}.json"
        detail = json.loads(path.read_text(encoding="utf-8"))
        for test in detail["tests"][:2]:
            checked_cases += 1
            result = run_one(detail["answer"], test, detail["unorderedOutput"])
            if not result["passed"]:
                failures.append((problem_id, result))

    if failures:
        for problem_id, result in failures:
            print(f"{problem_id}: {result}", file=sys.stderr)
        return 1
    print(f"Runner smoke test 通過：{len(SMOKE_IDS)} 題、{checked_cases} cases。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
