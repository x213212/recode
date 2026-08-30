#!/usr/bin/env python3
"""Convert the verified 481-problem workbook into browser-sized JSON files."""

from __future__ import annotations

import ast
import json
from pathlib import Path
import os
import re
import sys
from typing import Iterable


SITE_ROOT = Path(__file__).resolve().parents[1]
BOOK_ROOT = SITE_ROOT.parent / "interview_review_books"
DATA_ROOT = Path(
    os.environ.get("RECODE_SITE_DATA_OUTPUT", SITE_ROOT / "public" / "data")
).resolve()
PROBLEM_ROOT = DATA_ROOT / "problems"
DIFFICULTY_OVERRIDES_PATH = SITE_ROOT / "scripts" / "difficulty_overrides.json"

sys.path.insert(0, str(BOOK_ROOT))

from build_merged_book import load_chapters  # noqa: E402
from causal_derivations import (  # noqa: E402
    get_derivation_by_key,
    render_derivation_fields,
)
from explanation_style import compact_variable_names  # noqa: E402
from python_tool_notes import tool_notes_for  # noqa: E402


DIFFICULTY_OVERRIDES = json.loads(
    DIFFICULTY_OVERRIDES_PATH.read_text(encoding="utf-8")
)


SECTION_NAMES = {
    "statementZh": "完整題目（繁體中文）",
    "statementEn": "Original English statement",
}


def section(body: str, heading: str) -> str:
    match = re.search(
        rf"(?ms)^### {re.escape(heading)}\s*\n(.*?)(?=^### |\Z)",
        body,
    )
    return match.group(1).strip() if match else ""


def python_answer(body: str) -> str:
    answer_section = section(body, "AC Python")
    match = re.search(r"(?ms)```python\s*\n(.*?)```", answer_section)
    return match.group(1).strip() if match else ""


def parse_difficulty(body: str) -> str:
    match = re.search(r"難度[：:]\s*([A-Za-z\u4e00-\u9fff]+)", body)
    if not match:
        return "unknown"
    value = match.group(1).lower()
    if value in {"easy", "簡單", "简单"}:
        return "easy"
    if value in {"medium", "中等"}:
        return "medium"
    if value in {"hard", "困難", "困难"}:
        return "hard"
    return "unknown"


def extract_url(body: str) -> str:
    match = re.search(r"\[開啟原題\]\((https?://[^)]+)\)", body)
    return match.group(1) if match else ""


def clean_title(title: str) -> str:
    if " · " in title:
        return title.split(" · ", 1)[1].strip()
    return re.sub(r"^(?:\d+|Offer(?: II)? \d+|LCCI \d+\.\d+)\.?\s*", "", title)


def normalize_example_value(value: str) -> str:
    value = value.strip()
    value = re.split(
        r"\n(?:Explanation|解釋|解释|Constraints|提示)[：:]?",
        value,
        maxsplit=1,
    )[0].strip()
    return value


def example_blocks(statement: str) -> Iterable[str]:
    fenced = re.findall(r"(?ms)```(?:text)?\s*\n(.*?)```", statement)
    if fenced:
        yield from fenced
    else:
        yield statement


def extract_tests(statement: str) -> list[dict[str, str]]:
    tests: list[dict[str, str]] = []
    design_pattern = re.compile(
        r"(?ms)(?:^|\n)(?:Input|輸入|输入)\s*[：:]?\s*\n?"
        r"(\[[^\n]+\])\s*\n(\[[^\n]+\])\s*\n"
        r"(?:Output|輸出|输出)\s*[：:]?\s*\n?(\[[^\n]+\])"
    )
    pattern = re.compile(
        r"(?ms)(?:^|\n)(?:Input|輸入|输入)\s*[：:]\s*(.*?)"
        r"\n(?:Output|輸出|输出)\s*[：:]\s*(.*?)"
        r"(?=\n(?:Explanation|解釋|解释|Example|示例|範例|Constraints|提示)\b|\Z)"
    )
    for block in example_blocks(statement):
        for match in design_pattern.finditer(block.strip()):
            operations = normalize_example_value(match.group(1))
            arguments = normalize_example_value(match.group(2))
            expected = normalize_example_value(match.group(3))
            tests.append(
                {
                    "name": f"範例 {len(tests) + 1}",
                    "input": (
                        f"operations = {operations}, "
                        f"arguments = {arguments}"
                    ),
                    "expected": expected,
                }
            )
            if len(tests) >= 5:
                return tests
        for match in pattern.finditer(block.strip()):
            raw_input = normalize_example_value(match.group(1))
            expected = normalize_example_value(match.group(2))
            if raw_input and expected:
                tests.append(
                    {
                        "name": f"範例 {len(tests) + 1}",
                        "input": raw_input,
                        "expected": expected,
                    }
                )
            if len(tests) >= 5:
                return tests
    return tests


def skeleton(code: str) -> str:
    """Keep provided signatures while preserving every answer line position."""

    complete = overlay_answer(code)
    if not complete:
        return ""
    try:
        tree = ast.parse(complete)
    except SyntaxError:
        return complete

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
                range(
                    decorator.lineno,
                    (decorator.end_lineno or decorator.lineno) + 1,
                )
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

    lines = complete.splitlines()
    return "\n".join(
        line
        if line_number in kept_lines
        else line[: len(line) - len(line.lstrip())]
        for line_number, line in enumerate(lines, 1)
    )


def overlay_answer(code: str) -> str:
    """Return the complete import-free answer for the visual answer layer."""

    if not code:
        return ""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return ""

    executable = [
        node
        for node in tree.body
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
    ]
    if not executable:
        return ""

    module = ast.Module(body=executable, type_ignores=[])
    ast.fix_missing_locations(module)
    unparsed = ast.unparse(module).strip()
    return "\n".join(line for line in unparsed.splitlines() if line.strip())


def safe_id(key: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", key).strip("-").lower()


def fixed_tests(*cases: tuple[str, str]) -> list[dict[str, str]]:
    """Build stable executable fixtures for examples that are not machine-readable."""

    return [
        {
            "name": f"範例 {index}",
            "input": raw_input,
            "expected": expected,
        }
        for index, (raw_input, expected) in enumerate(cases, 1)
    ]


# Some official examples allow any valid order.  The prose is not consistent
# enough for the extractor to discover every one, so keep the contract here.
FORCE_UNORDERED_IDS = {
    "lc-212",
    "lc-417",
    "lcof-40",
    "lcof-56-i",
    "lcof-57",
    "lcci-08-04",
    "lcci-08-07",
    "lcci-10-02",
}


# These examples contain prose, C-style braces, diagrams, or renamed arguments.
# Correct them at generation time so `npm run data` can never recreate the
# malformed browser fixtures.
TEST_OVERRIDES = {
    "lc-68": fixed_tests(
        (
            'words = ["This","is","an","example","of","text",'
            '"justification."], maxWidth = 16',
            '["This    is    an","example  of text","justification.  "]',
        ),
        (
            'words = ["What","must","be","acknowledgment","shall","be"], '
            "maxWidth = 16",
            '["What   must   be","acknowledgment  ","shall be        "]',
        ),
        (
            'words = ["Science","is","what","we","understand","well",'
            '"enough","to","explain","to","a","computer.","Art","is",'
            '"everything","else","we","do"], maxWidth = 20',
            '["Science  is  what we","understand      well",'
            '"enough to explain to","a  computer.  Art is",'
            '"everything  else  we","do                  "]',
        ),
    ),
    "lcci-01-01": fixed_tests(
        ('text = "leetcode"', "false"),
        ('text = "abc"', "true"),
    ),
    "lcci-01-03": fixed_tests(
        ('text = "Mr John Smith    ", true_length = 13', '"Mr%20John%20Smith"'),
        ('text = "     ", true_length = 5', '"%20%20%20%20%20"'),
    ),
    "lcci-01-04": fixed_tests(
        ('text = "tactcoa"', "true"),
    ),
    "lcci-01-09": fixed_tests(
        ('first = "waterbottle", second = "erbottlewat"', "true"),
        ('first = "aa", second = "aba"', "false"),
    ),
    "lcci-02-02": fixed_tests(
        ("head = [1,2,3,4,5], k = 2", "4"),
    ),
    "lcci-02-03": fixed_tests(
        ("node = [4,5,1,9]", "[5,1,9]"),
    ),
    "lcci-02-04": fixed_tests(
        (
            "head = [3,5,8,5,10,2,1], boundary = 5",
            "[3,2,1,5,8,5,10]",
        ),
    ),
    "lcci-02-05": fixed_tests(
        ("first = [7,1,6], second = [5,9,2]", "[2,1,9]"),
        ("first = [2,4,3], second = [5,6,4]", "[7,0,8]"),
    ),
    "lcci-02-06": fixed_tests(
        ("head = [1,2]", "false"),
        ("head = [1,2,2,1]", "true"),
    ),
    "lcci-04-03": fixed_tests(
        (
            "tree = [1,2,3,4,5,null,7,8]",
            "[[1],[2,3],[4,5,7],[8]]",
        ),
    ),
    "lcci-04-05": fixed_tests(
        ("root = [2,1,3]", "true"),
        ("root = [5,1,4,null,null,3,6]", "false"),
    ),
    "lcci-04-06": fixed_tests(
        ("root = [2,1,3], target = 1", "2"),
        ("root = [5,3,6,2,4,null,null,1], target = 6", "null"),
    ),
    "lcci-05-01": fixed_tests(
        ("number = 1024, inserted = 19, start = 2, end = 6", "1100"),
        ("number = 0, inserted = 31, start = 0, end = 4", "31"),
    ),
    "lcci-05-02": fixed_tests(
        ("number = 0.625", '"0.101"'),
        ("number = 0.1", '"ERROR"'),
    ),
    "lcci-05-03": fixed_tests(
        ("number = 1775", "8"),
        ("number = 7", "4"),
    ),
    "lcci-05-04": fixed_tests(
        ("number = 2", "[4,1]"),
        ("number = 1", "[2,-1]"),
    ),
    "lcci-05-06": fixed_tests(
        ("first = 29, second = 15", "2"),
        ("first = 1, second = 2", "2"),
    ),
    "lcci-08-06": fixed_tests(
        ("source = [2,1,0], auxiliary = [], target = []", "[2,1,0]"),
        ("source = [1,0], auxiliary = [], target = []", "[1,0]"),
    ),
    "lcci-08-10": fixed_tests(
        (
            "image = [[1,1,1],[1,1,0],[1,0,1]], "
            "start_row = 1, start_column = 1, new_color = 2",
            "[[2,2,2],[2,2,0],[2,0,1]]",
        ),
    ),
    "lcci-10-01": fixed_tests(
        (
            "first = [1,2,3,0,0,0], first_count = 3, "
            "second = [2,5,6], second_count = 3",
            "[1,2,2,3,5,6]",
        ),
    ),
    "lcci-10-03": fixed_tests(
        (
            "numbers = [15,16,19,20,25,1,3,4,5,7,10,14], target = 5",
            "8",
        ),
        (
            "numbers = [15,16,19,20,25,1,3,4,5,7,10,14], target = 11",
            "-1",
        ),
    ),
    "lcci-16-03": fixed_tests(
        (
            "start1 = [0,0], end1 = [1,0], "
            "start2 = [1,1], end2 = [0,-1]",
            "[0.5,0]",
        ),
        (
            "start1 = [0,0], end1 = [3,3], "
            "start2 = [1,1], end2 = [2,2]",
            "[1,1]",
        ),
        (
            "start1 = [0,0], end1 = [1,1], "
            "start2 = [1,0], end2 = [2,1]",
            "[]",
        ),
    ),
    "lcci-16-06": fixed_tests(
        (
            "array1 = [1,3,15,11,2], array2 = [23,127,235,19,8]",
            "3",
        ),
    ),
    "lcci-16-13": fixed_tests(
        ("square1 = [-1,-1,2], square2 = [0,-1,2]", "[-1,0,2,0]"),
    ),
    "lcci-16-14": fixed_tests(
        ("points = [[0,0],[1,1],[1,0],[2,0]]", "[0,2]"),
    ),
    "lcci-16-26": fixed_tests(
        ('expression = "3+2*2"', "7"),
        ('expression = " 3/2 "', "1"),
        ('expression = " 3+5 / 2 "', "5"),
    ),
    "lcci-17-08": fixed_tests(
        (
            "height = [65,70,56,75,60,68], "
            "weight = [100,150,90,190,95,110]",
            "6",
        ),
    ),
    "lcci-17-22": fixed_tests(
        (
            'begin_word = "hit", end_word = "cog", '
            'word_list = ["hot","dot","dog","lot","log","cog"]',
            '["hit","hot","dot","dog","cog"]',
        ),
    ),
    "lcci-17-24": fixed_tests(
        ("matrix = [[-1,0],[0,-1]]", "[0,1,0,1]"),
    ),
    "lcof-extra-01": fixed_tests(
        ("buildings = [[1,3,2],[2,5,3]]", "11"),
        ("buildings = [[0,2,3],[4,5,2]]", "8"),
        ("buildings = [[1,5,4],[2,3,10]]", "22"),
    ),
    "lcof-03": fixed_tests(
        ("nums = [2,3,1,0,2,5,4]", "2"),
        ("nums = [0,1,3,2,3]", "3"),
    ),
    "lcof-21": fixed_tests(
        ("nums = [1,2,3,4]", "[1,3,2,4]"),
        ("nums = [2,4,1,3]", "[1,3,2,4]"),
    ),
    "lcof-40": fixed_tests(
        ("arr = [3,2,1], k = 2", "[1,2]"),
        ("arr = [0,1,2,1], k = 1", "[0]"),
    ),
    "lcof-56-i": fixed_tests(
        ("nums = [4,1,4,6]", "[1,6]"),
        ("nums = [1,2,10,4,1,4,3,3]", "[2,10]"),
    ),
    "lcof-57": fixed_tests(
        ("nums = [2,7,11,15], target = 9", "[2,7]"),
        (
            "nums = [10,26,30,31,47,60], target = 40",
            "[10,30]",
        ),
    ),
    "lcci-03-04": fixed_tests(
        (
            'operations = ["MyQueue","push","push","peek","pop","empty"], '
            "arguments = [[],[1],[2],[],[],[]]",
            "[null,null,null,1,1,false]",
        ),
        (
            'operations = ["MyQueue","push","empty","pop","empty"], '
            "arguments = [[],[3],[],[],[]]",
            "[null,null,false,3,true]",
        ),
    ),
    "lcci-10-09": fixed_tests(
        (
            "matrix = [[1,4,7,11,15],[2,5,8,12,19],"
            "[3,6,9,16,22],[10,13,14,17,24],"
            "[18,21,23,26,30]], target = 5",
            "true",
        ),
        (
            "matrix = [[1,4,7,11,15],[2,5,8,12,19],"
            "[3,6,9,16,22],[10,13,14,17,24],"
            "[18,21,23,26,30]], target = 20",
            "false",
        ),
    ),
    "lcci-08-09": fixed_tests(
        (
            "pair_count = 3",
            '["((()))","(()())","(())()","()(())","()()()"]',
        ),
        ("pair_count = 1", '["()"]'),
    ),
    "lcci-03-02": fixed_tests(
        (
            'operations = ["MinStack","push","push","push","getMin",'
            '"pop","top","getMin"], '
            "arguments = [[],[-2],[0],[-3],[],[],[],[]]",
            "[null,null,null,null,-3,null,0,-2]",
        ),
        (
            'operations = ["MinStack","push","push","getMin","pop",'
            '"getMin"], arguments = [[],[2],[1],[],[],[]]',
            "[null,null,null,1,null,2]",
        ),
    ),
    "lc-12": fixed_tests(
        ("num = 3749", '"MMMDCCXLIX"'),
        ("num = 58", '"LVIII"'),
        ("num = 1994", '"MCMXCIV"'),
    ),
    "lcci-17-20": fixed_tests(
        (
            'operations = ["MedianFinder","addNum","addNum",'
            '"findMedian","addNum","findMedian"], '
            "arguments = [[],[1],[2],[],[3],[]]",
            "[null,null,null,1.5,null,2.0]",
        ),
        (
            'operations = ["MedianFinder","addNum","findMedian",'
            '"addNum","findMedian"], '
            "arguments = [[],[-1],[],[-2],[]]",
            "[null,null,-1.0,null,-1.5]",
        ),
    ),
    "lcof-22": fixed_tests(
        ("head = [1,2,3,4,5], k = 2", "[4,5]"),
        ("head = [1], k = 1", "[1]"),
    ),
    "lcci-04-09": fixed_tests(
        ("root = [2,1,3]", "[[2,1,3],[2,3,1]]"),
        ("root = [1]", "[[1]]"),
    ),
    "lcci-16-02": fixed_tests(
        (
            'operations = ["WordsFrequency","get","get","get"], '
            'arguments = [[["i","have","an","apple","he","have",'
            '"a","pen"]],["you"],["have"],["apple"]]',
            "[null,0,2,1]",
        ),
        (
            'operations = ["WordsFrequency","get","get"], '
            'arguments = [[["code","code","review"]],["code"],["review"]]',
            "[null,2,1]",
        ),
    ),
    "lcci-04-12": fixed_tests(
        (
            "root = [5,4,8,11,null,13,4,7,2,null,null,5,1], "
            "target = 22",
            "3",
        ),
        ("root = [], target = 0", "0"),
    ),
    "lcci-04-04": fixed_tests(
        ("root = [3,9,20,null,null,15,7]", "true"),
        ("root = [1,2,2,3,3,null,null,4,4]", "false"),
    ),
    "lcci-01-07": fixed_tests(
        (
            "matrix = [[1,2,3],[4,5,6],[7,8,9]]",
            "[[7,4,1],[8,5,2],[9,6,3]]",
        ),
        (
            "matrix = [[5,1,9,11],[2,4,8,10],"
            "[13,3,6,7],[15,14,12,16]]",
            "[[15,13,2,5],[14,3,4,1],"
            "[12,6,8,9],[16,7,10,11]]",
        ),
    ),
    "lcci-16-25": fixed_tests(
        (
            'operations = ["LRUCache","put","put","get","put","get",'
            '"put","get","get","get"], '
            "arguments = [[2],[1,1],[2,2],[1],[3,3],[2],"
            "[4,4],[1],[3],[4]]",
            "[null,null,null,1,null,-1,null,-1,3,4]",
        ),
        (
            'operations = ["LRUCache","put","get","put","get","get"], '
            "arguments = [[1],[2,1],[2],[3,2],[2],[3]]",
            "[null,null,1,null,-1,2]",
        ),
    ),
    "lcof-32-i": fixed_tests(
        ("root = [3,9,20,null,null,15,7]", "[3,9,20,15,7]"),
        ("root = []", "[]"),
    ),
    "lcci-16-09": fixed_tests(
        (
            'operations = ["Operations","minus","multiply","divide"], '
            "arguments = [[],[1,2],[3,4],[5,-2]]",
            "[null,-1,12,-2]",
        ),
        (
            'operations = ["Operations","minus","multiply","divide"], '
            "arguments = [[],[-3,-5],[-4,3],[-9,-3]]",
            "[null,2,-12,3]",
        ),
    ),
    "lcof-32-iii": fixed_tests(
        (
            "root = [3,9,20,null,null,15,7]",
            "[[3],[20,9],[15,7]]",
        ),
        ("root = [1]", "[[1]]"),
    ),
    "lcci-04-02": fixed_tests(
        (
            "nums = [-10,-3,0,5,9]",
            "[0,-3,9,-10,null,5]",
        ),
        ("nums = [1,3]", "[3,1]"),
    ),
    "lcof-53-i": fixed_tests(
        ("nums = [5,7,7,8,8,10], target = 8", "2"),
        ("nums = [5,7,7,8,8,10], target = 6", "0"),
        ("nums = [], target = 0", "0"),
    ),
}


def main() -> None:
    chapters = load_chapters()
    PROBLEM_ROOT.mkdir(parents=True, exist_ok=True)
    index: list[dict[str, object]] = []

    ordered = sorted(
        chapters.values(),
        key=lambda chapter: (
            chapter.topic,
            int(re.search(r"\d+", chapter.identity).group())
            if re.search(r"\d+", chapter.identity)
            else 10**9,
            chapter.title,
        ),
    )

    for order, chapter in enumerate(ordered, 1):
        body = chapter.body
        answer = compact_variable_names(python_answer(body))
        statement_zh = section(body, SECTION_NAMES["statementZh"])
        statement_en = section(body, SECTION_NAMES["statementEn"])
        problem_id = safe_id(chapter.key)
        tests = TEST_OVERRIDES.get(
            problem_id,
            extract_tests(statement_en)
            or extract_tests(statement_zh),
        )
        difficulty = parse_difficulty(body)
        if difficulty == "unknown":
            difficulty = DIFFICULTY_OVERRIDES.get(problem_id, "unknown")
        if difficulty == "unknown":
            raise ValueError(f"{problem_id} 仍缺少難度標示")
        unordered = problem_id in FORCE_UNORDERED_IDS or bool(
            re.search(
                r"任意順序|任何順序|any order|order does not matter",
                statement_zh + "\n" + statement_en,
                re.IGNORECASE,
            )
        )
        summary = {
            "id": problem_id,
            "order": order,
            "identity": chapter.identity,
            "title": clean_title(chapter.title),
            "category": chapter.topic,
            "difficulty": difficulty,
            "sources": chapter.aliases,
            "testCount": len(tests),
            "runnable": bool(answer and tests),
        }
        derivation = get_derivation_by_key(chapter.key)
        if derivation is None:
            raise ValueError(f"{problem_id} 找不到經審查的因果題解來源")
        teaching_sections = {
            field: compact_variable_names(value)
            for field, value in render_derivation_fields(derivation).items()
        }
        required_teaching_fields = (
            "goal",
            "premise",
            "facts",
            "friction",
            "state",
            "memoryCard",
            "diagram",
            "route",
            "derivation",
            "proof",
            "trace",
            "wrongAlternative",
            "rebuild",
            "memoryLine",
            "standaloneSummary",
        )
        missing_teaching_fields = [
            field
            for field in required_teaching_fields
            if not teaching_sections[field].strip()
        ]
        if missing_teaching_fields:
            raise ValueError(
                f"{problem_id} 缺少 RECODE 題解欄位："
                f"{', '.join(missing_teaching_fields)}"
            )

        python_tools = [
            {
                "id": tool.tool_id,
                "name": tool.name,
                "note": tool.note,
                "example": tool.example,
            }
            for tool in tool_notes_for(answer)
        ]

        detail = {
            **summary,
            "url": extract_url(body),
            "statementZh": statement_zh,
            "statementEn": statement_en,
            **teaching_sections,
            "pythonTools": python_tools,
            "answer": answer,
            "starter": skeleton(answer),
            "overlayAnswer": overlay_answer(answer),
            "tests": tests,
            "unorderedOutput": unordered,
        }
        (PROBLEM_ROOT / f"{problem_id}.json").write_text(
            json.dumps(detail, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        index.append(summary)

    payload = {
        "version": 2,
        "generatedFrom": "第八本 481 題正向因果題解輸出",
        "total": len(index),
        "categories": sorted({str(item["category"]) for item in index}),
        "sources": sorted(
            {
                str(source)
                for item in index
                for source in item["sources"]  # type: ignore[union-attr]
            }
        ),
        "problems": index,
    }
    (DATA_ROOT / "index.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"產生 {len(index)} 題；"
        f"有範例測資 {sum(bool(item['testCount']) for item in index)} 題；"
        f"可執行 {sum(bool(item['runnable']) for item in index)} 題。"
    )


if __name__ == "__main__":
    main()
