import type {
  ProblemSummary,
  SubmissionEvent,
  TestResult
} from "./types.ts";

export type ErrorCategoryId =
  | "syntax"
  | "name"
  | "boundary"
  | "type"
  | "attribute"
  | "value"
  | "arithmetic"
  | "recursion"
  | "timeout"
  | "wrong-answer"
  | "runtime"
  | "runner"
  | "unknown";

export interface ErrorCategorySummary {
  id: ErrorCategoryId;
  label: string;
  explanation: string;
  count: number;
  percentage: number;
  topProblems: Array<{
    id: string;
    identity: string;
    title: string;
    count: number;
  }>;
  latestReason?: string;
}

const CATEGORY_COPY: Record<
  ErrorCategoryId,
  { label: string; explanation: string }
> = {
  syntax: {
    label: "語法／縮排",
    explanation: "括號、冒號、縮排或 Python 語法無法解析"
  },
  name: {
    label: "拼字／名稱",
    explanation: "變數、函式或類別名稱拼錯，或尚未定義"
  },
  boundary: {
    label: "索引／邊界",
    explanation: "索引超出範圍，或查詢不存在的 key"
  },
  type: {
    label: "型別／呼叫方式",
    explanation: "把值當成錯誤型別使用，或函式參數不符合"
  },
  attribute: {
    label: "屬性／方法",
    explanation: "物件沒有該屬性或方法，常見於節點、list 與函式混用"
  },
  value: {
    label: "值的格式",
    explanation: "型別正確，但內容無法轉換或不符合函式要求"
  },
  arithmetic: {
    label: "算術邊界",
    explanation: "除以零或其他算術例外"
  },
  recursion: {
    label: "遞迴深度",
    explanation: "base case 或狀態縮小有問題，導致遞迴沒有收斂"
  },
  timeout: {
    label: "逾時／死迴圈",
    explanation: "程式超過五秒，通常是複雜度過高或迴圈沒有前進"
  },
  "wrong-answer": {
    label: "答案邏輯",
    explanation: "程式可以執行，但輸出與預期答案不同"
  },
  runtime: {
    label: "其他執行錯誤",
    explanation: "執行期間發生尚未歸入上述類別的例外"
  },
  runner: {
    label: "執行環境",
    explanation: "Runner 或 Python Runtime 啟動失敗，不視為演算法錯誤"
  },
  unknown: {
    label: "舊紀錄／未分類",
    explanation: "舊提交沒有保存足夠的錯誤明細"
  }
};

const CATEGORY_ORDER: ErrorCategoryId[] = [
  "syntax",
  "name",
  "boundary",
  "type",
  "attribute",
  "value",
  "arithmetic",
  "recursion",
  "timeout",
  "wrong-answer",
  "runtime",
  "runner",
  "unknown"
];

function firstFailure(results: TestResult[] | undefined): TestResult | undefined {
  return results?.find((result) => !result.passed);
}

function exceptionName(result: TestResult | undefined): string {
  if (!result?.error) return "";
  const matches = result.error.match(
    /\b(?:SyntaxError|IndentationError|TabError|NameError|UnboundLocalError|IndexError|KeyError|TypeError|AttributeError|ValueError|OverflowError|ZeroDivisionError|ArithmeticError|RecursionError|MemoryError|StopIteration)\b/g
  );
  return matches?.at(-1) ?? "";
}

export function classifySubmissionError(
  event: SubmissionEvent
): ErrorCategoryId | null {
  if (event.passed) return null;

  const result = firstFailure(event.results);
  const exception = exceptionName(result);

  if (
    result?.errorType === "Syntax Error" ||
    exception === "SyntaxError" ||
    exception === "IndentationError" ||
    exception === "TabError"
  ) {
    return "syntax";
  }
  if (exception === "NameError" || exception === "UnboundLocalError") {
    return "name";
  }
  if (exception === "IndexError" || exception === "KeyError") {
    return "boundary";
  }
  if (exception === "TypeError") return "type";
  if (exception === "AttributeError") return "attribute";
  if (exception === "ValueError" || exception === "OverflowError") {
    return "value";
  }
  if (
    exception === "ZeroDivisionError" ||
    exception === "ArithmeticError"
  ) {
    return "arithmetic";
  }
  if (exception === "RecursionError") return "recursion";
  if (result?.errorType === "TLE") return "timeout";
  if (result?.errorType === "Wrong Answer") return "wrong-answer";
  if (result?.errorType === "Runner Error") return "runner";
  if (result?.errorType === "Runtime Error") return "runtime";
  return "unknown";
}

export function conciseFailureReason(
  event: SubmissionEvent
): string | undefined {
  const result = firstFailure(event.results);
  if (!result) return undefined;
  if (result.error) {
    return result.error
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
  }
  if (result.actual !== undefined || result.expected !== undefined) {
    return `實際 ${result.actual ?? "—"}，預期 ${result.expected ?? "—"}`;
  }
  return result.errorType;
}

export function buildErrorOverview(
  history: SubmissionEvent[],
  problems: ProblemSummary[]
): ErrorCategorySummary[] {
  const problemById = new Map(
    problems.map((problem) => [problem.id, problem])
  );
  const counts = new Map<ErrorCategoryId, number>();
  const problemCounts = new Map<
    ErrorCategoryId,
    Map<string, number>
  >();
  const latestReason = new Map<ErrorCategoryId, string>();

  for (const event of history) {
    const category = classifySubmissionError(event);
    if (!category) continue;
    counts.set(category, (counts.get(category) ?? 0) + 1);

    const byProblem = problemCounts.get(category) ?? new Map<string, number>();
    byProblem.set(event.problemId, (byProblem.get(event.problemId) ?? 0) + 1);
    problemCounts.set(category, byProblem);

    if (!latestReason.has(category)) {
      const reason = conciseFailureReason(event);
      if (reason) latestReason.set(category, reason);
    }
  }

  const total = Array.from(counts.values()).reduce(
    (sum, count) => sum + count,
    0
  );

  return CATEGORY_ORDER.filter((id) => (counts.get(id) ?? 0) > 0)
    .map((id) => {
      const count = counts.get(id) ?? 0;
      const topProblems = Array.from(
        problemCounts.get(id)?.entries() ?? []
      )
        .sort(
          ([firstId, firstCount], [secondId, secondCount]) =>
            secondCount - firstCount || firstId.localeCompare(secondId)
        )
        .slice(0, 3)
        .map(([problemId, problemCount]) => {
          const problem = problemById.get(problemId);
          return {
            id: problemId,
            identity: problem?.identity ?? problemId,
            title: problem?.title ?? "",
            count: problemCount
          };
        });
      return {
        id,
        ...CATEGORY_COPY[id],
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
        topProblems,
        ...(latestReason.has(id)
          ? { latestReason: latestReason.get(id) }
          : {})
      };
    })
    .sort(
      (first, second) =>
        second.count - first.count ||
        CATEGORY_ORDER.indexOf(first.id) -
          CATEGORY_ORDER.indexOf(second.id)
    );
}
