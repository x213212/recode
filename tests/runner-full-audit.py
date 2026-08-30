#!/usr/bin/env python3
"""Run every runnable solution in an isolated, timeout-bounded process."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
PROBLEMS = Path(
    os.environ.get("RECODE_SITE_DATA_OUTPUT", ROOT / "public" / "data")
).resolve() / "problems"
RUNNER = ROOT / "public" / "runner.py"
PER_PROBLEM_TIMEOUT_SECONDS = 3


def load_run_one():
    source = RUNNER.read_text(encoding="utf-8")
    source = source.rsplit("\nmain()", 1)[0]
    namespace: dict = {}
    exec(compile(source, "runner.py", "exec"), namespace)
    return namespace["run_one"]


def run_problem(path: Path) -> int:
    run_one = load_run_one()
    detail = json.loads(path.read_text(encoding="utf-8"))
    results = []

    for test in detail["tests"]:
        try:
            result = run_one(
                detail.get("overlayAnswer") or detail["answer"],
                test,
                detail["unorderedOutput"],
            )
        except SyntaxError as error:
            result = {
                "name": test.get("name", "測資"),
                "passed": False,
                "errorType": "Syntax Error",
                "error": str(error),
            }
        except Exception as error:
            result = {
                "name": test.get("name", "測資"),
                "passed": False,
                "errorType": "Runtime Error",
                "error": f"{type(error).__name__}: {error}",
            }
        results.append(result)

    print(json.dumps(results, ensure_ascii=False))
    return 0


def full_audit() -> int:
    problem_paths = sorted(
        path
        for path in PROBLEMS.glob("*.json")
        if not path.name.startswith("._")
    )
    runnable = []
    for path in problem_paths:
        detail = json.loads(path.read_text(encoding="utf-8"))
        if detail.get("runnable"):
            runnable.append((path, len(detail.get("tests", []))))

    failures = []
    checked_cases = 0
    for index, (path, test_count) in enumerate(runnable, start=1):
        try:
            completed = subprocess.run(
                [sys.executable, __file__, "--problem", str(path)],
                check=True,
                capture_output=True,
                text=True,
                timeout=PER_PROBLEM_TIMEOUT_SECONDS,
            )
            results = json.loads(completed.stdout)
            checked_cases += len(results)
            for result in results:
                if not result.get("passed"):
                    failures.append((path.stem, result))
        except subprocess.TimeoutExpired:
            checked_cases += test_count
            failures.append(
                (
                    path.stem,
                    {
                        "name": "整題逾時",
                        "passed": False,
                        "errorType": "TLE",
                        "error": (
                            f"超過 {PER_PROBLEM_TIMEOUT_SECONDS} 秒，"
                            "已由獨立程序安全終止"
                        ),
                    },
                )
            )
        except (subprocess.CalledProcessError, json.JSONDecodeError) as error:
            checked_cases += test_count
            failures.append(
                (
                    path.stem,
                    {
                        "name": "審計器錯誤",
                        "passed": False,
                        "errorType": "Runner Error",
                        "error": str(error),
                    },
                )
            )

        if index % 50 == 0:
            print(
                f"已驗證 {index}/{len(runnable)} 題",
                file=sys.stderr,
                flush=True,
            )

    if failures:
        report_path = ROOT / "artifacts" / "runner-full-audit.json"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(
                {
                    "runnableProblems": len(runnable),
                    "checkedCases": checked_cases,
                    "failures": [
                        {"problemId": problem_id, **result}
                        for problem_id, result in failures
                    ],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(
            f"完整 Runner 審計失敗：{len(failures)} 個 case。"
            f"完整報告：{report_path}",
            file=sys.stderr,
        )
        for problem_id, result in failures[:80]:
            print(
                f"{problem_id} / {result.get('name')}: "
                f"{result.get('errorType')} — "
                f"{result.get('error') or result.get('actual')}",
                file=sys.stderr,
            )
        if len(failures) > 80:
            print(
                f"其餘 {len(failures) - 80} 個錯誤已省略。",
                file=sys.stderr,
            )
        return 1

    print(
        f"完整 Runner 審計通過：{len(runnable)} 題、"
        f"{checked_cases} cases，全部在隔離逾時內完成。"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--problem", type=Path)
    arguments = parser.parse_args()
    if arguments.problem:
        return run_problem(arguments.problem)
    return full_audit()


if __name__ == "__main__":
    raise SystemExit(main())
