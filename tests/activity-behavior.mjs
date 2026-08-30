import assert from "node:assert/strict";

const {
  recordSubmission,
  removeProblemSubmissions,
  submissionIntensity
} = await import("../lib/activity.ts");

const failedEvent = {
  id: "failed-1",
  problemId: "lc-1",
  submittedAt: "2026-07-25T08:00:00+08:00",
  passed: false,
  durationMs: 12_000,
  code: "class Solution:\\n    return 1",
  results: [
    {
      name: "範例 1",
      passed: false,
      errorType: "Wrong Answer",
      input: "nums = [1, 2]",
      actual: "[]",
      expected: "[0, 1]"
    }
  ]
};
const first = recordSubmission({}, [], failedEvent);

assert.deepEqual(first.activity["2026-07-25"], {
  submissions: 1,
  passed: 0,
  failed: 1,
  totalMs: 12_000
});
assert.equal(
  submissionIntensity(first.activity["2026-07-25"].submissions),
  1,
  "第一次送出即使失敗，今天也必須立刻上色"
);

const passedEvent = {
  id: "passed-2",
  problemId: "lc-1",
  submittedAt: "2026-07-25T08:05:00+08:00",
  passed: true,
  durationMs: 18_000,
  code: "class Solution:\\n    return 2",
  results: [{ name: "範例 1", passed: true }]
};
const second = recordSubmission(
  first.activity,
  first.submissionHistory,
  passedEvent
);

assert.deepEqual(second.activity["2026-07-25"], {
  submissions: 2,
  passed: 1,
  failed: 1,
  totalMs: 30_000
});
assert.deepEqual(
  second.submissionHistory.map((event) => event.id),
  ["passed-2", "failed-1"],
  "逐筆紀錄必須由新到舊排列"
);
assert.equal(
  second.submissionHistory[0].code,
  "class Solution:\\n    return 2",
  "每次提交必須保存當下程式碼，不能只留下最後一版 draft"
);
assert.equal(
  second.submissionHistory[1].code,
  "class Solution:\\n    return 1",
  "修改後再次提交，不可覆蓋上一版程式碼"
);
assert.equal(
  second.submissionHistory[1].results[0].errorType,
  "Wrong Answer",
  "錯誤提交必須連同失敗原因與測資結果一起保存"
);
assert.equal(submissionIntensity(2), 2);
assert.equal(submissionIntensity(7), 4);

const otherProblemEvent = {
  ...passedEvent,
  id: "other-problem",
  problemId: "lc-2",
  durationMs: 5_000
};
const third = recordSubmission(
  second.activity,
  second.submissionHistory,
  otherProblemEvent
);
const removed = removeProblemSubmissions(
  third.activity,
  third.submissionHistory,
  "lc-1",
  {
    attempts: 2,
    passed: 1,
    totalMs: 30_000,
    lastStudiedAt: "2026-07-25T08:05:00+08:00"
  }
);

assert.deepEqual(
  removed.submissionHistory.map((event) => event.id),
  ["other-problem"],
  "清除本題紀錄不可誤刪其他題目的提交"
);
assert.deepEqual(removed.activity["2026-07-25"], {
  submissions: 1,
  passed: 1,
  failed: 0,
  totalMs: 5_000
});
assert.deepEqual(
  removed.removed.map((event) => event.id),
  ["passed-2", "failed-1"],
  "必須回傳被刪除的提交，才能同步修正本輪統計"
);

const legacyActivity = {
  "2026-07-25": {
    submissions: 4,
    passed: 2,
    failed: 2,
    totalMs: 40_000
  }
};
const legacyRemoved = removeProblemSubmissions(
  legacyActivity,
  [passedEvent],
  "lc-1",
  {
    attempts: 3,
    passed: 2,
    totalMs: 30_000,
    lastStudiedAt: "2026-07-25T08:05:00+08:00"
  }
);
assert.deepEqual(legacyRemoved.activity["2026-07-25"], {
  submissions: 3,
  passed: 1,
  failed: 2,
  totalMs: 22_000
});

console.log(
  "提交紀錄測試通過：每日累加、逐筆歷史、錯誤明細與單題安全清除。"
);
