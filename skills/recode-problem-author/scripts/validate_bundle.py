#!/usr/bin/env python3
"""Validate one RECODE staging bundle without importing it."""

from __future__ import annotations

import argparse
import ast
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from derive_problem_fields import overlay_answer, render_explanation, starter


SUMMARY_FIELDS = {
    "id", "order", "identity", "title", "category", "difficulty",
    "sources", "testCount", "runnable",
}
TEACHING_FIELDS = {
    "goal", "premise", "facts", "friction", "state", "memoryCard",
    "diagram", "route", "derivation", "proof", "trace",
    "wrongAlternative", "rebuild", "memoryLine", "standaloneSummary",
}
EXACT_FIELDS = SUMMARY_FIELDS | TEACHING_FIELDS | {
    "url", "statementZh", "statementEn", "pythonTools", "answer",
    "starter", "overlayAnswer", "tests", "unorderedOutput",
}
ALLOWED_IMPORTS = {
    "bisect", "collections", "functools", "heapq", "itertools", "math",
    "random", "re", "typing",
}
FORBIDDEN_CALLS = {"compile", "eval", "exec", "input", "open", "__import__"}


def literal_node(node: ast.AST) -> bool:
    if isinstance(node, ast.Constant):
        return True
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return all(literal_node(item) for item in node.elts)
    if isinstance(node, ast.Dict):
        return all(
            (key is None or literal_node(key)) and literal_node(value)
            for key, value in zip(node.keys, node.values)
        )
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        return literal_node(node.operand)
    if isinstance(node, ast.Name) and node.id in {"None", "True", "False"}:
        return True
    return False


def validate_fixture(test: dict[str, object], errors: list[str], index: int) -> None:
    prefix = f"tests[{index}]"
    if set(test) != {"name", "input", "expected"}:
        errors.append(f"{prefix} must contain exactly name/input/expected")
        return
    for field in ("name", "input", "expected"):
        if not isinstance(test[field], str) or not str(test[field]).strip():
            errors.append(f"{prefix}.{field} must be a non-empty string")
    try:
        expression = ast.parse(f"dict({test['input']})", mode="eval").body
        valid_input = (
            isinstance(expression, ast.Call)
            and isinstance(expression.func, ast.Name)
            and expression.func.id == "dict"
            and not expression.args
            and bool(expression.keywords)
            and all(
                keyword.arg is not None and literal_node(keyword.value)
                for keyword in expression.keywords
            )
        )
        if not valid_input:
            errors.append(f"{prefix}.input must be literal keyword assignments")
    except SyntaxError:
        errors.append(f"{prefix}.input is not valid fixture syntax")

    expected = re.sub(r"\bnull\b", "None", str(test["expected"]), flags=re.I)
    expected = re.sub(r"\btrue\b", "True", expected, flags=re.I)
    expected = re.sub(r"\bfalse\b", "False", expected, flags=re.I)
    try:
        if not literal_node(ast.parse(expected, mode="eval").body):
            errors.append(f"{prefix}.expected must be a literal value")
    except SyntaxError:
        errors.append(f"{prefix}.expected is not valid literal syntax")


def validate_python(answer: str, errors: list[str]) -> None:
    try:
        tree = ast.parse(answer)
    except SyntaxError as error:
        errors.append(f"answer has invalid Python syntax: {error}")
        return
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".", 1)[0] not in ALLOWED_IMPORTS:
                    errors.append(f"answer imports disallowed module: {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".", 1)[0]
            if root not in ALLOWED_IMPORTS:
                errors.append(f"answer imports from disallowed module: {node.module}")
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in FORBIDDEN_CALLS
        ):
            errors.append(f"answer calls disallowed builtin: {node.func.id}")


def read_bundle(bundle: Path) -> tuple[dict[str, object], list[str]]:
    errors: list[str] = []
    try:
        problem = json.loads((bundle / "problem.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return {}, [f"cannot read problem.json: {error}"]
    if not isinstance(problem, dict):
        return {}, ["problem.json root must be an object"]

    keys = set(problem)
    errors.extend(f"missing field: {field}" for field in sorted(EXACT_FIELDS - keys))
    errors.extend(f"unknown field: {field}" for field in sorted(keys - EXACT_FIELDS))
    if errors:
        return problem, errors

    required_text = {
        "id", "identity", "title", "category", "statementZh", "statementEn",
        "answer", "starter", "overlayAnswer",
    } | TEACHING_FIELDS
    for field in sorted(required_text):
        if not isinstance(problem[field], str) or not str(problem[field]).strip():
            errors.append(f"{field} must be a non-empty string")
    if not isinstance(problem["url"], str):
        errors.append("url must be a string")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", str(problem["id"])):
        errors.append("id must be a lowercase safe slug")
    if not isinstance(problem["order"], int) or isinstance(problem["order"], bool) or problem["order"] < 1:
        errors.append("order must be a positive integer")
    if problem["difficulty"] not in {"easy", "medium", "hard"}:
        errors.append("difficulty must be easy, medium, or hard")

    sources = problem["sources"]
    if (
        not isinstance(sources, list) or not sources
        or any(not isinstance(value, str) or not value.strip() for value in sources)
        or len(set(sources)) != len(sources)
    ):
        errors.append("sources must be a non-empty unique string array")

    tools = problem["pythonTools"]
    if not isinstance(tools, list):
        errors.append("pythonTools must be an array")
    else:
        tool_ids: list[str] = []
        for index, tool in enumerate(tools):
            if not isinstance(tool, dict) or set(tool) != {"id", "name", "note", "example"}:
                errors.append(f"pythonTools[{index}] has an invalid shape")
                continue
            if any(not isinstance(tool[field], str) or not tool[field].strip() for field in tool):
                errors.append(f"pythonTools[{index}] contains an empty field")
            tool_ids.append(str(tool["id"]))
        if len(tool_ids) != len(set(tool_ids)):
            errors.append("pythonTools IDs must be unique")

    tests = problem["tests"]
    if not isinstance(tests, list) or not tests:
        errors.append("tests must be a non-empty array")
        tests = []
    else:
        for index, test in enumerate(tests):
            if not isinstance(test, dict):
                errors.append(f"tests[{index}] must be an object")
            else:
                validate_fixture(test, errors, index)
        names = [str(test.get("name", "")) for test in tests if isinstance(test, dict)]
        if len(names) != len(set(names)):
            errors.append("test names must be unique")
    if problem["testCount"] != len(tests):
        errors.append("testCount must equal tests.length")
    if problem["runnable"] is not True:
        errors.append("an importable bundle must set runnable to true")
    if not isinstance(problem["unorderedOutput"], bool):
        errors.append("unorderedOutput must be boolean")

    answer = str(problem["answer"]).replace("\r\n", "\n").rstrip("\n")
    validate_python(answer, errors)
    try:
        if problem["overlayAnswer"] != overlay_answer(answer):
            errors.append("overlayAnswer is not the deterministic projection of answer")
        if problem["starter"] != starter(answer):
            errors.append("starter is not the deterministic signature skeleton")
    except (SyntaxError, ValueError) as error:
        errors.append(f"cannot derive code fields: {error}")

    expected_files = {
        "solution.py": answer + "\n",
        "tests.json": json.dumps(tests, ensure_ascii=False, indent=2) + "\n",
        "explanation.md": render_explanation(problem),
    }
    for name, expected in expected_files.items():
        try:
            actual = (bundle / name).read_text(encoding="utf-8").replace("\r\n", "\n")
            if actual != expected:
                errors.append(f"{name} does not match problem.json")
        except OSError as error:
            errors.append(f"cannot read {name}: {error}")
    return problem, errors


def sandbox_command(project: Path, bundle: Path) -> list[str]:
    bwrap = shutil.which("bwrap")
    if not bwrap:
        raise RuntimeError("bubblewrap is required for --run-tests")
    command = [bwrap, "--die-with-parent"]
    if os.environ.get("CODEX_SANDBOX_NETWORK_DISABLED") == "1":
        command += [
            "--unshare-user", "--unshare-pid", "--unshare-ipc",
            "--unshare-uts", "--unshare-cgroup-try",
        ]
    else:
        command += ["--unshare-all"]
    command += [
        "--new-session", "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/lib", "/lib",
    ]
    if Path("/lib64").exists():
        command += ["--ro-bind", "/lib64", "/lib64"]
    if Path("/etc/ld.so.cache").exists():
        command += ["--ro-bind", "/etc/ld.so.cache", "/etc/ld.so.cache"]
    command += [
        "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
        "--dir", "/work", "--dir", "/work/tests", "--dir", "/work/public",
        "--ro-bind", str(project / "tests" / "runner-full-audit.py"),
        "/work/tests/runner-full-audit.py",
        "--ro-bind", str(project / "public" / "runner.py"), "/work/public/runner.py",
        "--ro-bind", str(bundle), "/work/bundle", "--chdir", "/work",
        "--setenv", "PATH", "/usr/bin",
        "/usr/bin/prlimit", "--cpu=3", "--as=536870912", "--nproc=16",
        "--fsize=1048576", "--nofile=64", "--", "/usr/bin/python3",
        "/work/tests/runner-full-audit.py", "--problem", "/work/bundle/problem.json",
    ]
    return command


def run_tests(project: Path, problem: dict[str, object]) -> list[str]:
    failures: list[str] = []
    with tempfile.TemporaryDirectory(prefix="recode-problem-") as directory:
        root = Path(directory)
        for label, code in (("overlayAnswer", problem["overlayAnswer"]), ("answer", problem["answer"])):
            case = dict(problem)
            case["overlayAnswer"] = code
            bundle = root / label
            bundle.mkdir()
            (bundle / "problem.json").write_text(
                json.dumps(case, ensure_ascii=False), encoding="utf-8"
            )
            try:
                completed = subprocess.run(
                    sandbox_command(project, bundle), check=True,
                    capture_output=True, text=True, timeout=10,
                    env={"PATH": "/usr/bin"}, start_new_session=True,
                )
                results = json.loads(completed.stdout)
            except subprocess.CalledProcessError as error:
                detail = (error.stderr or error.stdout or str(error)).strip()
                failures.append(f"{label} runner failed: {detail}")
                continue
            except (subprocess.SubprocessError, json.JSONDecodeError, RuntimeError) as error:
                failures.append(f"{label} runner failed: {error}")
                continue
            for result in results:
                if not result.get("passed"):
                    failures.append(
                        f"{label} / {result.get('name')}: {result.get('errorType')} — "
                        f"{result.get('error') or result.get('actual')}"
                    )
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--project-root", type=Path)
    parser.add_argument("--run-tests", action="store_true")
    arguments = parser.parse_args()
    bundle = arguments.bundle.resolve()
    problem, errors = read_bundle(bundle)
    if not errors and arguments.run_tests:
        if not arguments.project_root:
            errors.append("--project-root is required with --run-tests")
        else:
            errors.extend(run_tests(arguments.project_root.resolve(), problem))
    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors))
        print(f"Validation failed with {len(errors)} error(s).")
        return 1
    suffix = " including sandboxed tests" if arguments.run_tests else ""
    print(f"Validated RECODE bundle{suffix}: {bundle}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
