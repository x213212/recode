import type { TestResult } from "./types.ts";

export function firstFailedResult(
  results: TestResult[] | undefined
): TestResult | undefined {
  return results?.find((result) => !result.passed);
}

export function hasRunnerFailure(
  results: TestResult[] | undefined
): boolean {
  return Boolean(
    results?.some((result) => result.errorType === "Runner Error")
  );
}

export function failureReason(result: TestResult | undefined): string {
  if (!result) return "沒有保存錯誤明細";

  if (result.error) {
    const lines = result.error
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const finalLine = lines.at(-1);
    if (finalLine) return `${result.name}：${finalLine}`;
  }

  if (result.actual !== undefined || result.expected !== undefined) {
    return `${result.name}：實際 ${result.actual ?? "—"}，預期 ${
      result.expected ?? "—"
    }`;
  }

  if (result.errorType === "Runner Error") {
    return `${result.name}：執行器中斷，本次未計入練習紀錄，請重新送出`;
  }

  return `${result.name}：測資未通過`;
}
