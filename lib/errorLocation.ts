import type { TestResult } from "./types.ts";

const JUMPABLE_ERROR_TYPES = new Set<TestResult["errorType"]>([
  "Syntax Error",
  "Runtime Error"
]);

/**
 * Runner 會把使用者程式編譯成 <solution>。
 * Runtime Error 可能有多層函式呼叫；最後一個 <solution> frame
 * 才是 Python 真正拋出例外的位置。
 */
export function sourceLineFromTestResult(
  result: TestResult | undefined
): number | null {
  if (
    !result?.errorType ||
    !JUMPABLE_ERROR_TYPES.has(result.errorType) ||
    !result.error
  ) {
    return null;
  }

  const matches = Array.from(
    result.error.matchAll(/File ["']<solution>["'], line (\d+)/g)
  );
  const lineNumber = Number(matches.at(-1)?.[1]);

  return Number.isInteger(lineNumber) && lineNumber > 0
    ? lineNumber
    : null;
}
