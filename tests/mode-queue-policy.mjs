import assert from "node:assert/strict";

const {
  deprioritizeRecentlySeenProblems,
  isRecordReadyForReview,
  mergeDueReviewsIntoQueue,
  normalizePracticeQueue,
  practiceModeQueuePolicy,
  queueAfterPreservedModeSwitch,
  sessionProblemsForMode
} = await import("../lib/review.ts");

const now = new Date("2026-08-26T08:00:00.000Z");

function problem(id, category, order) {
  return {
    id,
    order,
    identity: id,
    title: id,
    category,
    difficulty: "medium",
    sources: ["Core 75"],
    testCount: 2,
    runnable: true
  };
}

function record(overrides = {}) {
  return {
    status: "completed",
    attempts: 1,
    passed: 1,
    memoryPassed: 1,
    assistedPassed: 0,
    failed: 0,
    hints: 0,
    streak: 1,
    totalMs: 1_000,
    ...overrides
  };
}

function card(due) {
  return {
    algorithm_version: 7,
    due,
    stability: 10,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 10,
    learning_steps: 0,
    reps: 2,
    lapses: 0,
    state: 2,
    last_review: "2026-08-20T08:00:00.000Z"
  };
}

const future = card("2026-09-26T08:00:00.000Z");
const overdue = card("2026-08-25T08:00:00.000Z");

assert.equal(
  isRecordReadyForReview(record({ status: "retry", fsrs: future }), now),
  true,
  "retry 代表尚未完成的回想，即使 FSRS due 在未來也必須可重試"
);
assert.equal(
  isRecordReadyForReview(
    record({
      status: "retry",
      fsrs: future,
      recallCheckpointDue: "2026-08-26T08:30:00.000Z"
    }),
    now
  ),
  false,
  "Repeat checkpoint 冷卻仍優先於 retry，避免跟打後立刻重抽"
);

for (const mode of ["guided", "speed", "repeat", "interview"]) {
  assert.equal(
    practiceModeQueuePolicy(mode, true).allowEarly,
    false,
    `${mode} 不可因呼叫端誤傳 allowEarly 而提早抽未到期卡`
  );
}
assert.equal(practiceModeQueuePolicy("free").allowEarly, false);
assert.equal(practiceModeQueuePolicy("free", true).allowEarly, true);

const problems = [
  problem("due-array", "Array", 1),
  problem("due-tree", "Tree", 2),
  problem("retry-graph", "Graph", 3),
  problem("retry-no-card", "Stack", 4),
  problem("new-dp", "DP", 5),
  problem("future-array", "Array", 6),
  problem("future-tree", "Tree", 7),
  problem("cooling", "Heap", 8),
  problem("due-array", "Array", 9)
];
const records = {
  "due-array": record({ fsrs: overdue }),
  "due-tree": record({ fsrs: overdue }),
  "retry-graph": record({ status: "retry", fsrs: future }),
  "retry-no-card": record({
    status: "retry",
    attempts: 2,
    passed: 0,
    memoryPassed: 0,
    failed: 2
  }),
  "future-array": record({ fsrs: future }),
  "future-tree": record({ fsrs: future }),
  cooling: record({
    status: "retry",
    fsrs: future,
    recallCheckpointDue: "2026-08-26T08:30:00.000Z"
  })
};
const recordsBeforeQueueSelection = structuredClone(records);

for (const mode of ["guided", "speed", "repeat", "interview"]) {
  const ids = sessionProblemsForMode(mode, problems, records, {
    now,
    allowEarly: true,
    random: () => 0.999
  }).map((item) => item.id);
  assert.equal(ids.includes("future-array"), false, `${mode} 洩漏未到期卡`);
  assert.equal(ids.includes("future-tree"), false, `${mode} 洩漏未到期卡`);
  assert.equal(ids.includes("cooling"), false, `${mode} 洩漏冷卻中卡片`);
  assert.equal(ids.includes("retry-graph"), true, `${mode} 漏掉 retry`);
  assert.equal(
    ids.includes("retry-no-card"),
    true,
    `${mode} 漏掉尚未建立 FSRS 的 retry`
  );
  assert.equal(new Set(ids).size, ids.length, `${mode} queue 含重複題 id`);
}

const freeDueOnly = sessionProblemsForMode("free", problems, records, {
  now
}).map((item) => item.id);
assert.equal(freeDueOnly.includes("future-array"), false);
const freeAllowEarly = sessionProblemsForMode("free", problems, records, {
  now,
  allowEarly: true
}).map((item) => item.id);
assert.equal(freeAllowEarly.includes("future-array"), true);
assert.equal(freeAllowEarly.includes("future-tree"), true);
assert.equal(
  freeAllowEarly.includes("cooling"),
  false,
  "Free 提早練習也不可繞過 Repeat checkpoint 冷卻"
);
assert.equal(new Set(freeAllowEarly).size, freeAllowEarly.length);
const exploreIds = sessionProblemsForMode("explore", problems, records, {
  now
}).map((item) => item.id);
assert.equal(exploreIds.includes("future-array"), true);
assert.equal(
  exploreIds.includes("cooling"),
  false,
  "Explore 也不可在 Repeat checkpoint 冷卻期間重抽同題"
);
assert.deepEqual(
  records,
  recordsBeforeQueueSelection,
  "換模式、隨機下一題與 queue 排序只能讀 FSRS，不可污染排程資料"
);

assert.deepEqual(
  normalizePracticeQueue(
    ["", "due-array", "missing", "due-array", "due-tree"],
    ["due-array", "due-tree"]
  ),
  ["due-array", "due-tree"],
  "還原 queue 必須刪掉空值、無效 id 與重複 id"
);
assert.deepEqual(
  queueAfterPreservedModeSwitch(
    "due-array",
    ["due-array", "missing", "due-tree", "due-tree"],
    0,
    ["due-array", "due-tree"]
  ),
  ["due-array", "due-tree"]
);
assert.equal(
  mergeDueReviewsIntoQueue(
    problems,
    records,
    ["future-array"],
    0,
    now
  )[0],
  "due-array",
  "還原回合時到期舊題必須先插回 queue"
);
assert.ok(
  mergeDueReviewsIntoQueue(
    problems,
    records,
    ["future-array"],
    0,
    now
  ).includes("retry-no-card"),
  "尚未建立 FSRS 的 retry 也必須插回還原 queue"
);

const fair = deprioritizeRecentlySeenProblems(
  [
    problem("recent-array", "Array", 1),
    problem("fresh-array", "Array", 2),
    problem("fresh-tree", "Tree", 3),
    problem("recent-tree", "Tree", 4)
  ],
  ["recent-array", "recent-tree"]
).map((item) => item.id);
assert.deepEqual(
  fair,
  ["fresh-array", "fresh-tree", "recent-array", "recent-tree"],
  "同一優先層應先交錯未看過分類，再回收最近做過的題"
);

console.log(
  "模式 queue policy 測試通過：retry、due-only、Free allowEarly、去重與近期題降權皆正確。"
);
