import assert from "node:assert/strict";

const {
  failureReason,
  firstFailedResult,
  hasRunnerFailure
} = await import("../lib/testResultSummary.ts");

const wrongAnswer = {
  name: "範例 2",
  passed: false,
  errorType: "Wrong Answer",
  actual: "2",
  expected: "3"
};
const runtimeError = {
  name: "範例 1",
  passed: false,
  errorType: "Runtime Error",
  error:
    "Traceback (most recent call last):\n  line 4\nNameError: name 'value' is not defined\n"
};

assert.equal(
  firstFailedResult([
    { name: "範例 1", passed: true },
    wrongAnswer
  ]),
  wrongAnswer
);
assert.equal(
  failureReason(wrongAnswer),
  "範例 2：實際 2，預期 3"
);
assert.equal(
  failureReason(runtimeError),
  "範例 1：NameError: name 'value' is not defined"
);
assert.equal(failureReason(undefined), "沒有保存錯誤明細");
assert.equal(
  failureReason({
    name: "Worker 錯誤",
    passed: false,
    errorType: "Runner Error"
  }),
  "Worker 錯誤：執行器中斷，本次未計入練習紀錄，請重新送出"
);
assert.equal(
  hasRunnerFailure([
    {
      name: "執行器",
      passed: false,
      errorType: "Runner Error"
    }
  ]),
  true,
  "執行器故障不可被當成使用者錯誤提交"
);
assert.equal(hasRunnerFailure([wrongAnswer, runtimeError]), false);

console.log("錯誤摘要測試通過：優先抓失敗測資並顯示具體原因。");
