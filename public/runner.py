import ast
import contextlib
import inspect
import io
import json
import math
import heapq
import bisect
import random
import re
import traceback
from collections import *
from functools import *
from itertools import *
from typing import *


class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


class Node:
    def __init__(self, val=0, *args, **kwargs):
        self.val = val
        self.children = kwargs.get("children", [])
        self.neighbors = kwargs.get("neighbors", [])
        self.prev = kwargs.get("prev")
        self.next = kwargs.get("next")
        self.random = kwargs.get("random")
        self.child = kwargs.get("child")
        self.left = kwargs.get("left")
        self.right = kwargs.get("right")
        self.isLeaf = kwargs.get("isLeaf")
        self.topLeft = kwargs.get("topLeft")
        self.topRight = kwargs.get("topRight")
        self.bottomLeft = kwargs.get("bottomLeft")
        self.bottomRight = kwargs.get("bottomRight")

        # LeetCode reuses the name Node for several incompatible structures.
        # Support the positional constructors used by the bundled solutions.
        if len(args) == 1:
            self.children = args[0] or []
            self.neighbors = args[0] or []
            self.next = args[0]
        elif len(args) == 2:
            self.next, self.random = args
            self.left, self.right = args
        elif len(args) == 3:
            self.prev, self.next, self.child = args
            self.left, self.right = args[:2]
        elif len(args) == 5:
            (
                self.isLeaf,
                self.topLeft,
                self.topRight,
                self.bottomLeft,
                self.bottomRight,
            ) = args


def build_list(values):
    dummy = ListNode()
    tail = dummy
    for value in values or []:
        tail.next = ListNode(value)
        tail = tail.next
    return dummy.next


def build_cycle_list(values, position=-1):
    if not values:
        return None
    nodes = [ListNode(value) for value in values]
    for index in range(len(nodes) - 1):
        nodes[index].next = nodes[index + 1]
    if 0 <= position < len(nodes):
        nodes[-1].next = nodes[position]
    return nodes[0]


def build_intersecting_lists(raw_values):
    first_values = raw_values.get("listA", [])
    second_values = raw_values.get("listB", [])
    first_skip = raw_values.get("skipA", len(first_values))
    second_skip = raw_values.get("skipB", len(second_values))
    intersection_value = raw_values.get("intersectVal", 0)

    if not intersection_value:
        return build_list(first_values), build_list(second_values)

    shared = build_list(first_values[first_skip:])

    def attach(prefix_values):
        dummy = ListNode()
        tail = dummy
        for value in prefix_values:
            tail.next = ListNode(value)
            tail = tail.next
        tail.next = shared
        return dummy.next

    return (
        attach(first_values[:first_skip]),
        attach(second_values[:second_skip]),
    )


def build_graph(adjacency):
    if not adjacency:
        return None
    nodes = [Node(index + 1) for index in range(len(adjacency))]
    for index, neighbors in enumerate(adjacency):
        nodes[index].neighbors = [nodes[value - 1] for value in neighbors]
    return nodes[0]


def graph_values(node):
    if node is None:
        return []
    nodes = {}
    queue = deque([node])
    while queue:
        current = queue.popleft()
        if current.val in nodes:
            continue
        nodes[current.val] = current
        queue.extend(current.neighbors)
    return [
        [neighbor.val for neighbor in nodes[value].neighbors]
        for value in sorted(nodes)
    ]


def build_random_list(entries):
    if not entries:
        return None
    nodes = [Node(entry[0]) for entry in entries]
    for index, (_, random_index) in enumerate(entries):
        nodes[index].next = nodes[index + 1] if index + 1 < len(nodes) else None
        nodes[index].random = (
            None if random_index is None else nodes[random_index]
        )
    return nodes[0]


def random_list_values(head):
    nodes = []
    index_by_node = {}
    current = head
    while current is not None and current not in index_by_node:
        index_by_node[current] = len(nodes)
        nodes.append(current)
        current = current.next
    return [
        [
            node.val,
            None if node.random is None else index_by_node[node.random],
        ]
        for node in nodes
    ]


def build_node_tree(values):
    if not values:
        return None
    root = Node(values[0])
    queue = deque([root])
    index = 1
    while queue and index < len(values):
        current = queue.popleft()
        if index < len(values) and values[index] is not None:
            current.left = Node(values[index])
            queue.append(current.left)
        index += 1
        if index < len(values) and values[index] is not None:
            current.right = Node(values[index])
            queue.append(current.right)
        index += 1
    return root


def build_circular_list(values):
    if not values:
        return None
    nodes = [Node(value) for value in values]
    for index, node in enumerate(nodes):
        node.next = nodes[(index + 1) % len(nodes)]
    return nodes[0]


def build_multilevel_list(values):
    """Decode LeetCode 430's level-by-level list representation."""

    if not values:
        return None

    def build_level(start):
        nodes = []
        previous = None
        index = start
        while index < len(values) and values[index] is not None:
            current = Node(values[index])
            current.prev = previous
            if previous is not None:
                previous.next = current
            nodes.append(current)
            previous = current
            index += 1
        return nodes, index

    previous_level, index = build_level(0)
    if not previous_level:
        return None
    head = previous_level[0]

    while index < len(values):
        # The first null closes the current level. Additional nulls move the
        # child attachment point to the right in the previous level.
        index += 1
        parent_offset = 0
        while index < len(values) and values[index] is None:
            parent_offset += 1
            index += 1
        if index >= len(values):
            break

        current_level, index = build_level(index)
        if not current_level or parent_offset >= len(previous_level):
            raise ValueError("無法解析多級雙向鏈結串列測資")
        previous_level[parent_offset].child = current_level[0]
        previous_level = current_level

    return head


def circular_values(head, pointer="next"):
    values = []
    seen = set()
    current = head
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        values.append(current.val)
        current = getattr(current, pointer)
    return values


def list_values(head):
    values = []
    seen = set()
    while head is not None and id(head) not in seen:
        seen.add(id(head))
        values.append(head.val)
        head = head.next
    return values


def build_tree(values):
    if not values:
        return None
    values = list(values)
    if values[0] is None:
        return None
    root = TreeNode(values[0])
    queue = deque([root])
    index = 1
    while queue and index < len(values):
        node = queue.popleft()
        if index < len(values) and values[index] is not None:
            node.left = TreeNode(values[index])
            queue.append(node.left)
        index += 1
        if index < len(values) and values[index] is not None:
            node.right = TreeNode(values[index])
            queue.append(node.right)
        index += 1
    return root


def tree_values(root):
    if root is None:
        return []
    values = []
    queue = deque([root])
    while queue:
        node = queue.popleft()
        if node is None:
            values.append(None)
            continue
        values.append(node.val)
        queue.append(node.left)
        queue.append(node.right)
    while values and values[-1] is None:
        values.pop()
    return values


def find_tree_node(root, value):
    if root is None:
        return None
    queue = deque([root])
    while queue:
        node = queue.popleft()
        if node.val == value:
            return node
        if node.left:
            queue.append(node.left)
        if node.right:
            queue.append(node.right)
    return None


def normalise_literals(text):
    text = re.sub(
        r"[\u200b-\u200f\u202a-\u202e\u2060\ufeff]",
        "",
        text,
    )
    text = text.strip().replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    text = text.replace(r"\_", "_").replace(r"\*", "*")
    text = re.sub(r"\bnull\b", "None", text, flags=re.I)
    text = re.sub(r"\btrue\b", "True", text, flags=re.I)
    text = re.sub(r"\bfalse\b", "False", text, flags=re.I)
    return text


def parse_input(raw):
    text = normalise_literals(raw)
    text = re.sub(r"^(?:Input|輸入|输入)\s*[：:]\s*", "", text, flags=re.I)

    # Most LeetCode examples are a comma-separated keyword argument list.
    try:
        expression = ast.parse(f"dict({text})", mode="eval")
        call = expression.body
        if (
            not isinstance(call, ast.Call)
            or call.args
            or not call.keywords
        ):
            raise ValueError("not a keyword argument list")
        return eval(
            compile(expression, "<input>", "eval"),
            {"dict": dict},
        )
    except Exception:
        pass

    # Some statements place one assignment on each line.
    try:
        module = ast.parse(text, mode="exec")
        values = {}
        scope = {}
        for statement in module.body:
            if not isinstance(statement, (ast.Assign, ast.AnnAssign)):
                raise ValueError("not assignments")
            exec(compile(ast.Module([statement], type_ignores=[]), "<input>", "exec"), {}, scope)
        for statement in module.body:
            targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
            for target in targets:
                if isinstance(target, ast.Name):
                    values[target.id] = scope[target.id]
        if values:
            return values
    except Exception:
        pass

    # Some design-problem examples print the operation list and argument list
    # as two consecutive expressions instead of naming them.
    try:
        module = ast.parse(text, mode="exec")
        expressions = [
            ast.literal_eval(statement.value)
            for statement in module.body
            if isinstance(statement, ast.Expr)
        ]
        if (
            len(expressions) == 2
            and isinstance(expressions[0], list)
            and isinstance(expressions[1], list)
        ):
            return {
                "operations": expressions[0],
                "arguments": expressions[1],
            }
    except Exception:
        pass

    # A few copied statements append an ASCII diagram after a valid first
    # input line. Only that first line belongs to the executable fixture.
    first_line = next(
        (line.strip() for line in text.splitlines() if line.strip()),
        "",
    )
    if first_line and first_line != text:
        try:
            call = ast.parse(f"dict({first_line})", mode="eval")
            return eval(compile(call, "<input>", "eval"), {"dict": dict})
        except Exception:
            try:
                return ast.literal_eval(first_line)
            except Exception:
                pass

    try:
        return ast.literal_eval(text)
    except Exception:
        return text


def parse_expected(raw):
    text = normalise_literals(raw)
    text = re.sub(r"^(?:Output|輸出|输出)\s*[：:]\s*", "", text, flags=re.I)
    try:
        return ast.literal_eval(text)
    except Exception:
        try:
            return float(text) if "." in text else int(text)
        except Exception:
            return text.strip()


def annotation_text(parameter):
    value = parameter.annotation
    return "" if value is inspect.Parameter.empty else str(value)


def convert_argument(
    name,
    value,
    parameter,
    root=None,
    raw_values=None,
):
    annotation = annotation_text(parameter)
    lower_name = name.lower()
    if (
        "List[ListNode" in annotation
        or "List[Optional" in annotation
        or lower_name == "lists"
    ) and isinstance(value, list):
        return [build_list(item) for item in value]
    if (
        isinstance(raw_values, dict)
        and lower_name == "head"
        and "pos" in raw_values
        and isinstance(value, list)
    ):
        return build_cycle_list(value, raw_values["pos"])
    if "ListNode" in annotation or (
        lower_name
        in {
            "head",
            "heada",
            "headb",
            "first_head",
            "second_head",
        }
        and "Node" not in annotation
    ):
        if isinstance(value, list):
            return build_list(value)
    if (
        root is not None
        and "TreeNode" in annotation
        and not isinstance(value, TreeNode)
        and not isinstance(value, list)
    ):
        return find_tree_node(root, value)
    if "TreeNode" in annotation or (
        lower_name in {"root", "subroot"} and "Node" not in annotation
    ):
        if isinstance(value, list):
            return build_tree(value)
    if lower_name in {"p", "q"} and root is not None and not isinstance(value, TreeNode):
        return find_tree_node(root, value)
    if "Node" in annotation and isinstance(value, list):
        if lower_name == "node" and all(
            isinstance(item, list) for item in value
        ):
            return build_graph(value)
        if (
            lower_name == "head"
            and value
            and all(
                isinstance(item, list) and len(item) == 2
                for item in value
            )
        ):
            return build_random_list(value)
        if lower_name == "root":
            return build_node_tree(value)
        if (
            lower_name == "head"
            and isinstance(raw_values, dict)
            and any(
                key in raw_values
                for key in ("insertVal", "insert_value")
            )
        ):
            return build_circular_list(value)
        if lower_name == "head":
            return build_multilevel_list(value)
    return value


def convert_call_arguments(raw_values, parameters):
    if not isinstance(raw_values, dict):
        if isinstance(raw_values, tuple):
            values = list(raw_values)
        else:
            values = [raw_values]
        return [
            convert_argument(
                parameter.name,
                value,
                parameter,
                raw_values=raw_values,
            )
            for parameter, value in zip(parameters, values)
        ]

    if {
        "listA",
        "listB",
        "skipA",
        "skipB",
    }.issubset(raw_values) and len(parameters) == 2:
        return list(build_intersecting_lists(raw_values))

    required = [
        parameter
        for parameter in parameters
        if parameter.default is inspect.Parameter.empty
        and parameter.kind
        not in {
            inspect.Parameter.VAR_POSITIONAL,
            inspect.Parameter.VAR_KEYWORD,
        }
    ]
    use_names = all(parameter.name in raw_values for parameter in required)

    if use_names:
        pairs = [
            (parameter, raw_values[parameter.name])
            for parameter in parameters
            if parameter.name in raw_values
        ]
    else:
        ignored_keys = {
            "bad",
            "intersectVal",
            "pick",
            "pos",
            "skipA",
            "skipB",
        }
        values = [
            value
            for key, value in raw_values.items()
            if key not in ignored_keys
        ]
        pairs = list(zip(parameters, values))

    root = None
    converted = []
    for parameter, value in pairs:
        if parameter.name.lower() == "root":
            root = convert_argument(
                parameter.name,
                value,
                parameter,
                raw_values=raw_values,
            )
            converted.append(root)
            continue
        converted.append(
            convert_argument(
                parameter.name,
                value,
                parameter,
                root,
                raw_values,
            )
        )
    return converted


def public_methods(solution_class):
    return [
        (name, value)
        for name, value in solution_class.__dict__.items()
        if not name.startswith("_") and callable(value)
    ]


def choose_method(solution_class, raw_values):
    methods = public_methods(solution_class)
    if not methods:
        raise RuntimeError("Solution 裡找不到可執行的方法")
    if not isinstance(raw_values, dict):
        return methods[0][0]

    keys = set(raw_values)
    scored = []
    for index, (name, method) in enumerate(methods):
        params = list(inspect.signature(method).parameters.values())[1:]
        names = {parameter.name for parameter in params}
        scored.append((len(keys & names), -abs(len(names) - len(keys)), -index, name))
    return max(scored)[-1]


def quad_values(root):
    if root is None:
        return []
    values = []
    queue = deque([root])
    while queue:
        node = queue.popleft()
        if node is None:
            values.append(None)
            continue
        values.append([int(bool(node.isLeaf)), int(bool(node.val))])
        queue.extend(
            [
                node.topLeft,
                node.topRight,
                node.bottomLeft,
                node.bottomRight,
            ]
        )
    while values and values[-1] is None:
        values.pop()
    return values


def next_level_values(root):
    values = []
    level_head = root
    while level_head is not None:
        current = level_head
        next_head = None
        while current is not None:
            values.append(current.val)
            if next_head is None:
                next_head = current.left or current.right
            current = current.next
        values.append("#")
        level_head = next_head
    return values


def serialise_node(value):
    if value.isLeaf is not None:
        return quad_values(value)
    if value.neighbors:
        return graph_values(value)
    if value.next is not None:
        current = value
        seen = set()
        has_random = False
        while current is not None and id(current) not in seen:
            seen.add(id(current))
            has_random = has_random or current.random is not None
            current = current.next
        if has_random:
            return random_list_values(value)
        return circular_values(value)
    if value.left is not None or value.right is not None:
        if (
            value.left is not None
            and value.right is not None
            and value.left.right is value
            and value.right.left is value
        ):
            return circular_values(value, "right")
        return tree_values(value)
    return [value.val]


def serialise(value):
    if isinstance(value, TreeNode):
        return tree_values(value)
    if isinstance(value, ListNode):
        return list_values(value)
    if isinstance(value, Node):
        return serialise_node(value)
    if isinstance(value, set):
        return sorted(serialise(item) for item in value)
    if isinstance(value, tuple):
        return [serialise(item) for item in value]
    if isinstance(value, list):
        return [serialise(item) for item in value]
    if isinstance(value, dict):
        return {str(key): serialise(item) for key, item in value.items()}
    return value


def comparable(value):
    value = serialise(value)
    if isinstance(value, float):
        return round(value, 7)
    if isinstance(value, list):
        return [comparable(item) for item in value]
    if isinstance(value, dict):
        return {key: comparable(item) for key, item in value.items()}
    return value


def unordered_key(value):
    """Ignore only the outer result order; preserve each result item's shape."""

    if not isinstance(value, list):
        return value
    return sorted(
        value,
        key=lambda item: json.dumps(
            item,
            ensure_ascii=False,
            sort_keys=True,
        ),
    )


def equal(
    actual,
    expected,
    unordered=False,
    raw_expected="",
    args=None,
    method_name="",
):
    if method_name in {"findWords", "permutation"}:
        return (
            isinstance(actual, list)
            and isinstance(expected, list)
            and sorted(actual) == sorted(expected)
        )

    if method_name == "pacificAtlantic":
        return (
            isinstance(actual, list)
            and isinstance(expected, list)
            and {tuple(point) for point in actual}
            == {tuple(point) for point in expected}
        )

    if method_name == "subsets":
        return (
            isinstance(actual, list)
            and isinstance(expected, list)
            and {
                tuple(sorted(subset))
                for subset in actual
            }
            == {
                tuple(sorted(subset))
                for subset in expected
            }
        )

    if method_name == "groupAnagrams":
        def canonical_groups(groups):
            return sorted(
                tuple(sorted(group))
                for group in groups
            )

        return (
            isinstance(actual, list)
            and isinstance(expected, list)
            and canonical_groups(actual) == canonical_groups(expected)
        )

    if method_name == "exchange":
        if not isinstance(actual, list) or not isinstance(expected, list):
            return False
        reached_even = False
        for value in actual:
            if value % 2 == 0:
                reached_even = True
            elif reached_even:
                return False
        return sorted(actual) == sorted(expected)

    if method_name == "sortedArrayToBST" and args:
        numbers = args[0]

        def inspect_tree(node):
            if node is None:
                return [], 0, True
            left_values, left_height, left_ok = inspect_tree(node.left)
            right_values, right_height, right_ok = inspect_tree(node.right)
            return (
                left_values + [node.val] + right_values,
                max(left_height, right_height) + 1,
                left_ok
                and right_ok
                and abs(left_height - right_height) <= 1,
            )

        values, _, balanced = inspect_tree(actual)
        return values == numbers and balanced

    if method_name == "findOrder" and args and isinstance(actual, list):
        course_count, prerequisites = args
        if not actual:
            return expected == []
        if (
            len(actual) != course_count
            or set(actual) != set(range(course_count))
        ):
            return False
        position = {
            course: index for index, course in enumerate(actual)
        }
        return all(
            position[prerequisite] < position[course]
            for course, prerequisite in prerequisites
        )

    if method_name == "partition" and len(args or []) >= 2:
        values = serialise(actual)
        boundary = args[1]
        if not isinstance(values, list) or not isinstance(expected, list):
            return False
        seen_larger = False
        for value in values:
            if value >= boundary:
                seen_larger = True
            elif seen_larger:
                return False
        return sorted(values) == sorted(expected)

    if method_name == "pathWithObstacles" and args:
        grid = args[0]
        if not actual:
            return expected == []
        if actual[0] != [0, 0] or actual[-1] != [
            len(grid) - 1,
            len(grid[0]) - 1,
        ]:
            return False
        return all(
            grid[row][column] == 0
            and (
                index == 0
                or (
                    (row - actual[index - 1][0], column - actual[index - 1][1])
                    in {(1, 0), (0, 1)}
                )
            )
            for index, (row, column) in enumerate(actual)
        )

    if method_name == "wiggleSort" and isinstance(actual, list):
        if not isinstance(expected, list) or sorted(actual) != sorted(expected):
            return False
        return all(
            actual[index - 1] >= actual[index]
            if index % 2 == 1
            else actual[index - 1] <= actual[index]
            for index in range(1, len(actual))
        )

    if method_name == "findSwapValues" and len(args or []) == 2:
        if actual == []:
            return expected == []
        if not isinstance(actual, list) or len(actual) != 2:
            return False
        first, second = actual
        return (
            first in args[0]
            and second in args[1]
            and sum(args[0]) - first + second
            == sum(args[1]) - second + first
        )

    if method_name == "findLadders" and len(args or []) == 3:
        begin_word, end_word, words = args
        if not actual:
            return expected == []
        return (
            actual[0] == begin_word
            and actual[-1] == end_word
            and len(actual) == len(expected)
            and all(word in words for word in actual[1:])
            and all(
                sum(left != right for left, right in zip(first, second))
                == 1
                for first, second in zip(actual, actual[1:])
            )
        )

    if actual is None and isinstance(expected, str):
        lower = expected.lower()
        if (
            "no intersection" in lower
            or "no cycle" in lower
            or lower.strip().startswith("null")
            or lower.strip().startswith("none")
        ):
            return True

    if (
        isinstance(actual, Node)
        and isinstance(expected, list)
        and expected
        and all(isinstance(item, list) for item in expected)
        and actual.isLeaf is None
        and actual.next is None
        and actual.left is None
        and actual.right is None
    ):
        return graph_values(actual) == expected

    if isinstance(actual, (TreeNode, Node)) and isinstance(
        expected,
        (int, float, str),
    ):
        if isinstance(expected, str) and "#" in expected and isinstance(actual, Node):
            expected_tokens = [
                int(token) if token.strip().lstrip("-").isdigit() else token.strip()
                for token in expected.strip("[]").split(",")
            ]
            return next_level_values(actual) == expected_tokens
        return actual.val == expected

    if isinstance(actual, ListNode) and isinstance(expected, str):
        lower = expected.lower()
        if "no intersection" in lower or "no cycle" in lower:
            return False
        value_match = re.search(r"['\"](-?\d+)['\"]", expected)
        if not value_match:
            value_match = re.search(r"value\s*=\s*(-?\d+)", expected, re.I)
        if value_match:
            return actual.val == int(value_match.group(1))
        index_match = re.search(r"index\s+(-?\d+)", lower)
        if index_match and args:
            target_index = int(index_match.group(1))
            current = args[0]
            seen = set()
            index = 0
            while current is not None and id(current) not in seen:
                if current is actual:
                    return index == target_index
                seen.add(id(current))
                current = current.next
                index += 1
            return False

    in_place_match = re.match(
        r"^\s*(-?\d+)\s*,\s*\w+\s*=",
        normalise_literals(raw_expected),
    )
    if in_place_match and isinstance(actual, int):
        expected_length = int(in_place_match.group(1))
        if actual != expected_length:
            return False
        if not args or not isinstance(args[0], list):
            return True
        list_match = re.search(r"=\s*(\[.*\])", raw_expected, re.S)
        if not list_match:
            return True
        tokens = [
            token.strip()
            for token in list_match.group(1).strip("[]").split(",")
        ]
        expected_prefix = [
            ast.literal_eval(token)
            for token in tokens[:expected_length]
            if token != "_"
        ]
        actual_prefix = args[0][:expected_length]
        if method_name == "removeElement":
            return sorted(actual_prefix) == sorted(expected_prefix)
        return actual_prefix == expected_prefix

    if actual is None and expected == []:
        return True

    actual = comparable(actual)
    expected = comparable(expected)
    if unordered and isinstance(actual, list) and isinstance(expected, list):
        return unordered_key(actual) == unordered_key(expected)

    def deep_equal(first, second):
        if isinstance(first, (int, float)) and isinstance(
            second,
            (int, float),
        ):
            return math.isclose(
                first,
                second,
                rel_tol=1e-5,
                abs_tol=1e-5,
            )
        if isinstance(first, list) and isinstance(second, list):
            return len(first) == len(second) and all(
                deep_equal(left, right)
                for left, right in zip(first, second)
            )
        if isinstance(first, dict) and isinstance(second, dict):
            return first.keys() == second.keys() and all(
                deep_equal(first[key], second[key])
                for key in first
            )
        return first == second

    return deep_equal(actual, expected)


def display(value):
    try:
        return json.dumps(serialise(value), ensure_ascii=False)
    except Exception:
        return repr(value)


def run_design_case(namespace, raw_values):
    operations = raw_values["operations"]
    arguments = raw_values["arguments"]
    if not operations or len(operations) != len(arguments):
        raise RuntimeError("設計題 operations 與 arguments 長度不一致")

    class_name = operations[0]
    if class_name not in namespace:
        raise RuntimeError(f"找不到設計題類別 {class_name}")

    design_class = namespace[class_name]
    constructor_parameters = list(
        inspect.signature(design_class).parameters.values()
    )
    constructor_args = convert_call_arguments(
        tuple(arguments[0]),
        constructor_parameters,
    )
    instance = design_class(*constructor_args)
    outputs = [None]

    for operation, values in zip(operations[1:], arguments[1:]):
        method = getattr(instance, operation)
        parameters = list(inspect.signature(method).parameters.values())
        method_args = convert_call_arguments(tuple(values), parameters)
        outputs.append(method(*method_args))
    return outputs


def equal_design_case(raw_values, actual, expected, unordered=False):
    operations = raw_values["operations"]
    arguments = raw_values["arguments"]
    class_name = operations[0] if operations else ""

    if class_name == "RandomizedSet":
        if not isinstance(actual, list) or len(actual) != len(operations):
            return False
        values = set()
        if actual[0] is not None:
            return False
        for index, (operation, args) in enumerate(
            zip(operations[1:], arguments[1:]),
            1,
        ):
            value = args[0] if args else None
            if operation == "insert":
                should_insert = value not in values
                if actual[index] != should_insert:
                    return False
                if should_insert:
                    values.add(value)
            elif operation == "remove":
                should_remove = value in values
                if actual[index] != should_remove:
                    return False
                if should_remove:
                    values.remove(value)
            elif operation == "getRandom":
                if not values or actual[index] not in values:
                    return False
            else:
                return False
        return True

    if operations[1:] and all(
        operation == "pickIndex"
        for operation in operations[1:]
    ):
        weights = arguments[0][0] if arguments and arguments[0] else []
        return (
            isinstance(actual, list)
            and len(actual) == len(operations)
            and actual[0] is None
            and all(
                isinstance(index, int)
                and 0 <= index < len(weights)
                for index in actual[1:]
            )
        )

    return equal(actual, expected, unordered)


def run_codec_case(namespace, raw_values):
    if "Codec" not in namespace or not isinstance(raw_values, dict):
        raise RuntimeError("找不到 class Solution 或設計題操作序列")
    codec = namespace["Codec"]()
    value = next(iter(raw_values.values()))

    if hasattr(codec, "encode") and hasattr(codec, "decode"):
        return codec.decode(codec.encode(value))
    if hasattr(codec, "serialize") and hasattr(codec, "deserialize"):
        root = build_tree(value)
        return codec.deserialize(codec.serialize(root))
    raise RuntimeError("Codec 缺少可配對驗證的方法")


def run_one(user_code, test, unordered):
    raw_values = parse_input(test["input"])
    expected = parse_expected(test["expected"])
    stdout = io.StringIO()

    namespace = {
        "__name__": "__main__",
        "List": List,
        "Optional": Optional,
        "Dict": Dict,
        "Set": Set,
        "Tuple": Tuple,
        "Deque": Deque,
        "DefaultDict": DefaultDict,
        "Counter": Counter,
        "defaultdict": defaultdict,
        "deque": deque,
        "heapq": heapq,
        "bisect": bisect,
        "bisect_left": bisect.bisect_left,
        "bisect_right": bisect.bisect_right,
        "math": math,
        "random": random,
        "ListNode": ListNode,
        "TreeNode": TreeNode,
        "Node": Node,
        "inf": float("inf"),
    }

    # Platform APIs used by a few binary-search questions.
    if isinstance(raw_values, dict):
        picked = raw_values.get("pick")
        bad = raw_values.get("bad")
        namespace["guess"] = lambda number: 0 if number == picked else (-1 if number > picked else 1)
        namespace["isBadVersion"] = lambda version: bad is not None and version >= bad

    with contextlib.redirect_stdout(stdout):
        # The editor intentionally focuses on the requested Solution method.
        # This hidden wrapper supplies the imports LeetCode normally supplies.
        prelude = """
from typing import *
from collections import *
from functools import *
from itertools import *
from math import *
from builtins import pow
import heapq
import bisect
import math
import random
"""
        # 隱藏 imports 與使用者程式分開編譯。這樣 traceback 內
        # <solution> 的行號就是 editor 行號，不會被 prelude 推後。
        exec(compile(prelude, "<recode-prelude>", "exec"), namespace)
        exec(compile(user_code, "<solution>", "exec"), namespace)

        if (
            isinstance(raw_values, dict)
            and "operations" in raw_values
            and "arguments" in raw_values
        ):
            result = run_design_case(namespace, raw_values)
            passed = equal_design_case(
                raw_values,
                result,
                expected,
                unordered,
            )
            return {
                "name": test["name"],
                "passed": passed,
                "errorType": None if passed else "Wrong Answer",
                "input": test["input"],
                "actual": display(result),
                "expected": display(expected),
                "stdout": stdout.getvalue(),
            }

        if "Solution" not in namespace:
            result = run_codec_case(namespace, raw_values)
            passed = equal(
                result,
                expected,
                unordered,
                test["expected"],
            )
            return {
                "name": test["name"],
                "passed": passed,
                "errorType": None if passed else "Wrong Answer",
                "input": test["input"],
                "actual": display(result),
                "expected": display(expected),
                "stdout": stdout.getvalue(),
            }

        solution_class = namespace["Solution"]
        method_name = choose_method(solution_class, raw_values)
        method = getattr(solution_class(), method_name)
        signature = inspect.signature(method)
        parameters = list(signature.parameters.values())
        args = convert_call_arguments(raw_values, parameters)

        result = method(*args)
        # LeetCode in-place questions often return None and inspect the first input.
        return_annotation = signature.return_annotation
        returns_none = (
            return_annotation is None
            or return_annotation is type(None)
            or str(return_annotation) in {"None", "NoneType"}
        )
        if (
            result is None
            and returns_none
            and args
            and expected is not None
        ):
            result = args[2] if method_name == "hanota" else args[0]

    passed = equal(
        result,
        expected,
        unordered,
        test["expected"],
        args,
        method_name,
    )
    return {
        "name": test["name"],
        "passed": passed,
        "errorType": None if passed else "Wrong Answer",
        "input": test["input"],
        "actual": display(result),
        "expected": display(expected),
        "stdout": stdout.getvalue(),
    }


def main():
    tests = json.loads(TEST_CASES_JSON)
    results = []
    for test in tests:
        try:
            results.append(run_one(USER_CODE, test, bool(UNORDERED_OUTPUT)))
        except SyntaxError:
            results.append(
                {
                    "name": test.get("name", "測資"),
                    "passed": False,
                    "errorType": "Syntax Error",
                    "input": test.get("input", ""),
                    "expected": test.get("expected", ""),
                    "error": traceback.format_exc(limit=5),
                }
            )
        except Exception:
            results.append(
                {
                    "name": test.get("name", "測資"),
                    "passed": False,
                    "errorType": "Runtime Error",
                    "input": test.get("input", ""),
                    "expected": test.get("expected", ""),
                    "error": traceback.format_exc(limit=5),
                }
            )
    return json.dumps({"results": results}, ensure_ascii=False)


main()
