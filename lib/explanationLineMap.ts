import type { ProblemDetail } from "@/lib/types";

interface DerivationStep {
  title: string;
  code: string;
}

interface LineMatch extends DerivationStep {
  startLine: number;
  endLine: number;
  variables: string[];
}

const PYTHON_WORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "case",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "match",
  "None",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "self",
  "True",
  "try",
  "while",
  "with",
  "yield"
]);

const NON_STATE_NAMES = new Set([
  "bool",
  "collections",
  "Counter",
  "defaultdict",
  "deque",
  "dict",
  "enumerate",
  "float",
  "heapq",
  "int",
  "len",
  "List",
  "list",
  "max",
  "min",
  "Node",
  "Optional",
  "range",
  "set",
  "Solution",
  "sorted",
  "str",
  "sum",
  "TreeNode",
  "tuple",
  "zip"
]);
NON_STATE_NAMES.add("_");

function compactCode(line: string) {
  return line
    .replace(/\s+/g, "")
    .replace(/"/g, "'")
    .replace(/^\(([A-Za-z_]\w*(?:,[A-Za-z_]\w*)+)\)=/, "$1=");
}

function derivationSteps(derivation: string): DerivationStep[] {
  const steps: DerivationStep[] = [];
  const sections = derivation.matchAll(
    /####\s+第\s*\d+\s*(?:步|段)[｜|]\s*(.+?)\n([\s\S]*?)(?=\n####\s+第\s*\d+\s*(?:步|段)[｜|]|$)/g
  );

  for (const section of sections) {
    const code = section[2].match(/```python\s*\n([\s\S]*?)```/);
    if (!code?.[1].trim()) continue;
    steps.push({
      title: section[1].trim().replace(/[。.]$/, ""),
      code: code[1].trim()
    });
  }

  return steps;
}

function identifiers(code: string) {
  return [...code.matchAll(/\b[A-Za-z_]\w*\b/g)].map(
    (match) => match[0]
  );
}

function assignmentTargets(code: string) {
  const targets: string[] = [];
  for (const line of code.split("\n")) {
    const assignment = line.match(
      /^\s*\(?([A-Za-z_][\w\s,]*)\)?\s*(?:=|\+=|-=|\*=|\/=|\|=|&=)/
    );
    if (!assignment) continue;
    for (const name of assignment[1].split(",")) {
      const clean = name.trim();
      if (/^[A-Za-z_]\w*$/.test(clean) && !targets.includes(clean)) {
        targets.push(clean);
      }
    }
  }
  return targets;
}

function findStepStart(
  answerLines: string[],
  snippet: string,
  startAt: number
): number | null {
  const firstLine = snippet
    .split("\n")
    .map(compactCode)
    .find(Boolean);
  if (!firstLine) return null;

  const answer = answerLines.map(compactCode);
  const openExpression = /[([{]$/.test(firstLine);
  for (let index = Math.max(0, startAt); index < answer.length; index += 1) {
    if (
      answer[index] === firstLine ||
      (openExpression && answer[index].startsWith(firstLine))
    ) {
      return index;
    }
  }

  const targets = assignmentTargets(snippet);
  if (targets.length) {
    for (let index = Math.max(0, startAt); index < answer.length; index += 1) {
      const lineTargets = assignmentTargets(answerLines[index]);
      if (targets.some((target) => lineTargets.includes(target))) {
        return index;
      }
    }
  }

  const names = new Set(
    identifiers(snippet).filter(
      (name) => !PYTHON_WORDS.has(name) && !NON_STATE_NAMES.has(name)
    )
  );
  const leadingKeyword = snippet.trim().match(/^(return|if|elif|for|while)\b/)?.[1];
  let bestIndex: number | null = null;
  let bestScore = 0;

  answerLines.forEach((line, index) => {
    if (index < startAt) return;
    const lineNames = new Set(identifiers(line));
    let score = 0;
    for (const name of names) {
      if (lineNames.has(name)) score += 2;
    }
    if (leadingKeyword && line.trim().startsWith(leadingKeyword)) score += 4;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  return bestIndex !== null && bestScore >= 2 ? bestIndex : null;
}

function stateVariables(code: string) {
  const withoutStrings = code.replace(
    /(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
    " "
  );
  const methodNames = new Set(
    [...withoutStrings.matchAll(/\.([A-Za-z_]\w*)/g)].map(
      (match) => match[1]
    )
  );
  const declaredFunctions = new Set(
    [...withoutStrings.matchAll(/\bdef\s+([A-Za-z_]\w*)/g)].map(
      (match) => match[1]
    )
  );
  const calledFunctions = new Set(
    [...withoutStrings.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map(
      (match) => match[1]
    )
  );
  const variables: string[] = [];

  for (const match of withoutStrings.matchAll(/\b[A-Za-z_]\w*\b/g)) {
    const name = match[0];
    if (
      PYTHON_WORDS.has(name) ||
      NON_STATE_NAMES.has(name) ||
      methodNames.has(name) ||
      declaredFunctions.has(name) ||
      calledFunctions.has(name) ||
      variables.includes(name)
    ) {
      continue;
    }
    variables.push(name);
  }

  return variables.slice(0, 6);
}

function lineLabel(startLine: number, endLine: number) {
  return startLine === endLine
    ? `L${startLine}`
    : `L${startLine}–L${endLine}`;
}

/** Map each reasoning step back to RECODE's import-free AC answer. */
export function explanationLineMapMarkdown(
  problem: Pick<
    ProblemDetail,
    "answer" | "derivation" | "overlayAnswer"
  >
) {
  const answer = problem.overlayAnswer.trim() || problem.answer.trim();
  if (!answer) return "";

  const answerLines = answer.split("\n");
  const located: Array<DerivationStep & { startIndex: number }> = [];
  let searchFrom = 0;

  for (const step of derivationSteps(problem.derivation)) {
    const startIndex = findStepStart(answerLines, step.code, searchFrom);
    if (startIndex === null) continue;
    located.push({ ...step, startIndex });
    searchFrom = startIndex + 1;
  }

  const matches: LineMatch[] = located.map((step, index) => ({
    title: step.title,
    code: step.code,
    startLine: step.startIndex + 1,
    endLine:
      index + 1 < located.length
        ? located[index + 1].startIndex
        : answerLines.length,
    variables: stateVariables(step.code)
  }));

  if (!matches.length) return "";

  const rows = matches.map((match) => {
    const variables = match.variables.length
      ? match.variables.map((name) => `\`${name}\``).join("、")
      : "控制流程";
    return `- **${lineLabel(match.startLine, match.endLine)}｜${variables}**：${match.title}`;
  });

  return [
    "## 最後對回右側 AC 程式碼",
    "",
    "> 行號以右側內建 AC 主幹為準。先看行號找到程式碼，再讀冒號後面的存在原因。",
    "",
    ...rows
  ].join("\n");
}
