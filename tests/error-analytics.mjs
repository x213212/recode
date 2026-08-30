import assert from "node:assert/strict";

import {
  buildErrorOverview,
  classifySubmissionError
} from "../lib/errorAnalytics.ts";

function failedEvent(id, problemId, result) {
  return {
    id,
    problemId,
    submittedAt: `2026-07-27T00:00:0${id}.000Z`,
    passed: false,
    durationMs: 1000,
    results: [result]
  };
}

const syntax = failedEvent("1", "lc-1", {
  name: "語法",
  passed: false,
  errorType: "Syntax Error",
  error: "Traceback\nSyntaxError: invalid syntax"
});
const typo = failedEvent("2", "lc-1", {
  name: "測資 1",
  passed: false,
  errorType: "Runtime Error",
  error: "Traceback\nNameError: name 'retrun' is not defined"
});
const boundary = failedEvent("3", "lc-994", {
  name: "測資 2",
  passed: false,
  errorType: "Runtime Error",
  error: "Traceback\nIndexError: list index out of range"
});
const wrong = failedEvent("4", "lc-994", {
  name: "測資 3",
  passed: false,
  errorType: "Wrong Answer",
  actual: "0",
  expected: "2"
});

assert.equal(classifySubmissionError(syntax), "syntax");
assert.equal(classifySubmissionError(typo), "name");
assert.equal(classifySubmissionError(boundary), "boundary");
assert.equal(classifySubmissionError(wrong), "wrong-answer");
assert.equal(
  classifySubmissionError({ ...wrong, passed: true }),
  null,
  "AC 不可出現在錯誤一覽"
);

const overview = buildErrorOverview(
  [typo, wrong, boundary, syntax],
  [
    {
      id: "lc-1",
      identity: "1",
      title: "兩數之和",
      order: 1,
      category: "Array",
      difficulty: "easy",
      sources: [],
      testCount: 1,
      runnable: true
    },
    {
      id: "lc-994",
      identity: "994",
      title: "腐爛的橘子",
      order: 2,
      category: "BFS",
      difficulty: "medium",
      sources: [],
      testCount: 1,
      runnable: true
    }
  ]
);

assert.equal(
  overview.reduce((total, category) => total + category.count, 0),
  4
);
assert.equal(
  overview.find((category) => category.id === "name")?.latestReason,
  "NameError: name 'retrun' is not defined"
);
assert.equal(
  overview.find((category) => category.id === "boundary")
    ?.topProblems[0].identity,
  "994"
);

console.log("錯誤分類測試通過：語法、拼字、邊界與 Wrong Answer 可正確統計。");
