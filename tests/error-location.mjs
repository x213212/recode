import assert from "node:assert/strict";

const { sourceLineFromTestResult } = await import(
  "../lib/errorLocation.ts"
);

assert.equal(
  sourceLineFromTestResult({
    name: "範例",
    passed: false,
    errorType: "Syntax Error",
    error:
      'Traceback (most recent call last):\n  File "<solution>", line 7\n    return (\nSyntaxError: "(" was never closed\n'
  }),
  7,
  "Syntax Error 應定位到 <solution> 的精確行號"
);

assert.equal(
  sourceLineFromTestResult({
    name: "範例",
    passed: false,
    errorType: "Runtime Error",
    error:
      'Traceback (most recent call last):\n  File "<solution>", line 3, in solve\n  File "<solution>", line 9, in helper\nIndexError: list index out of range\n'
  }),
  9,
  "Runtime Error 應定位到最深層、真正拋錯的使用者程式行"
);

assert.equal(
  sourceLineFromTestResult({
    name: "範例",
    passed: false,
    errorType: "Wrong Answer",
    error: 'File "<solution>", line 4'
  }),
  null,
  "Wrong Answer 沒有可靠錯誤行，不可亂跳"
);

assert.equal(
  sourceLineFromTestResult({
    name: "範例",
    passed: false,
    errorType: "Runtime Error",
    error: 'File "<string>", line 19'
  }),
  null,
  "舊版帶 wrapper 偏移的 <string> 行號不可拿來定位"
);

console.log("錯誤行定位測試通過：只定位精確的 <solution> 行號。");
