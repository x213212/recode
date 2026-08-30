import assert from "node:assert/strict";

import {
  isMemoryEligibleSubmission,
  memoryEligiblePassCount,
  rebuildMemoryCards,
  recentMemoryFailureCount,
  reviewOriginForRecord,
  statusAfterSubmissionEvidence,
  submissionMemoryPolicy
} from "../lib/memoryEvidence.ts";
import { assessAcceptedSubmission } from "../lib/review.ts";
import { scheduleReview } from "../lib/fsrs.ts";

const independent = submissionMemoryPolicy({
  mode: "guided",
  answerRevealCount: 0
});
assert.deepEqual(independent, {
  memoryEligible: true,
  canScheduleAcceptedReview: true,
  reason: "independent-recall"
});

assert.equal(
  reviewOriginForRecord(undefined, "guided", new Date("2026-08-26T00:00:00Z")),
  "new"
);
assert.equal(
  reviewOriginForRecord(
    {
      status: "retry",
      attempts: 1,
      passed: 0,
      failed: 1,
      hints: 0,
      streak: 0,
      totalMs: 1,
      fsrs: scheduleReview(undefined, "again", new Date("2026-08-26T00:00:00Z"))
    },
    "guided",
    new Date("2026-08-26T00:01:00Z")
  ),
  "retry",
  "失敗後 retry 不可被未來 due 隱藏"
);

for (const reviewOrigin of ["early", "same-session", "manual"]) {
  const policy = submissionMemoryPolicy({
    mode: "free",
    answerRevealCount: 0,
    reviewOrigin
  });
  assert.equal(policy.memoryEligible, false, `${reviewOrigin} 不可污染 FSRS`);
  assert.equal(policy.canScheduleAcceptedReview, false);
}

for (const mode of ["free", "interview"]) {
  const clean = submissionMemoryPolicy({
    mode,
    answerRevealCount: 0
  });
  assert.equal(
    clean.memoryEligible,
    true,
    `${mode} 無提示送出必須保留為真正提取證據`
  );
}

const explorePractice = submissionMemoryPolicy({
  mode: "explore",
  answerRevealCount: 0
});
assert.equal(explorePractice.memoryEligible, false);
assert.equal(explorePractice.reason, "manual-review");

for (const answerRevealCount of [1, 2]) {
  const assisted = submissionMemoryPolicy({
    mode: "free",
    answerRevealCount
  });
  assert.equal(assisted.memoryEligible, false);
  assert.equal(assisted.canScheduleAcceptedReview, false);
  assert.equal(assisted.reason, "answer-assisted");
}

const repeat = submissionMemoryPolicy({
  mode: "repeat",
  answerRevealCount: 0
});
assert.equal(repeat.memoryEligible, false);
assert.equal(repeat.canScheduleAcceptedReview, false);
assert.equal(repeat.reason, "repeat-guided");

const speedClean = submissionMemoryPolicy({
  mode: "speed",
  answerRevealCount: 0,
  speedSubmittedInTime: true,
  speedWasTimeoutRewrite: false,
  speedSolutionWasVisible: false,
  speedSubmittedLate: false
});
assert.equal(speedClean.memoryEligible, true);
assert.equal(speedClean.canScheduleAcceptedReview, true);

const speedRewrite = submissionMemoryPolicy({
  mode: "speed",
  answerRevealCount: 1,
  speedSubmittedInTime: false,
  speedWasTimeoutRewrite: true,
  speedSolutionWasVisible: false,
  speedSubmittedLate: false
});
assert.equal(speedRewrite.memoryEligible, false);
assert.equal(speedRewrite.reason, "speed-timeout-rewrite");

const speedVisible = submissionMemoryPolicy({
  mode: "speed",
  answerRevealCount: 1,
  speedSubmittedInTime: true,
  speedWasTimeoutRewrite: false,
  speedSolutionWasVisible: true,
  speedSubmittedLate: false
});
assert.equal(speedVisible.memoryEligible, false);
assert.equal(speedVisible.reason, "speed-answer-visible");

const speedLate = submissionMemoryPolicy({
  mode: "speed",
  answerRevealCount: 0,
  speedSubmittedInTime: false,
  speedWasTimeoutRewrite: false,
  speedSolutionWasVisible: false,
  speedSubmittedLate: true
});
assert.equal(speedLate.memoryEligible, false);
assert.equal(speedLate.reason, "speed-late-submit");

const history = [
  {
    id: "repeat-pass",
    problemId: "target",
    submittedAt: "2026-07-27T00:04:00.000Z",
    passed: true,
    durationMs: 1_000,
    memoryEligible: false,
    memoryEvidenceReason: "repeat-guided"
  },
  {
    id: "real-failure",
    problemId: "target",
    submittedAt: "2026-07-27T00:03:00.000Z",
    passed: false,
    durationMs: 1_000,
    memoryEligible: true,
    memoryEvidenceReason: "independent-recall"
  },
  {
    id: "assisted-pass",
    problemId: "target",
    submittedAt: "2026-07-27T00:02:00.000Z",
    passed: true,
    durationMs: 1_000,
    answerRevealCount: 1
  },
  {
    id: "old-clean-pass",
    problemId: "target",
    submittedAt: "2026-07-27T00:01:00.000Z",
    passed: true,
    durationMs: 1_000
  }
];

assert.equal(isMemoryEligibleSubmission(history[2]), false);
assert.equal(isMemoryEligibleSubmission(history[3]), true);
assert.equal(memoryEligiblePassCount(history, "target"), 1);
assert.equal(
  recentMemoryFailureCount(history, "target"),
  1,
  "Repeat／看答案的 AC 不可截斷真正的失敗證據鏈"
);
assert.equal(
  recentMemoryFailureCount(
    history,
    "target",
    "2026-07-27T00:03:30.000Z"
  ),
  0,
  "FSRS 已結算時間以前的錯誤不可污染下一個回合"
);
assert.equal(
  assessAcceptedSubmission(history, "target", {
    durationMs: 60_000,
    difficulty: "easy"
  }).failures,
  1,
  "記憶評分只能讀取 memoryEligible 的歷史"
);
assert.equal(
  assessAcceptedSubmission(history, "target", {
    durationMs: 60_000,
    difficulty: "easy",
    previousReviewAt: "2026-07-27T00:03:30.000Z"
  }).failures,
  0,
  "已經由 Speed 逾時結算的錯誤不可在下一次 AC 再算一次"
);
assert.equal(
  statusAfterSubmissionEvidence({
    currentStatus: "new",
    passed: true,
    memoryEligible: false,
    acceptedStatus: "completed"
  }),
  "learning",
  "有答案協助的 AC 只能代表練過，不可直接宣稱已完成記憶"
);
assert.equal(
  statusAfterSubmissionEvidence({
    currentStatus: "completed",
    passed: false,
    memoryEligible: false,
    acceptedStatus: "completed"
  }),
  "completed",
  "引導練習中的錯誤不可把既有記憶狀態降成 retry"
);
assert.equal(
  statusAfterSubmissionEvidence({
    currentStatus: "completed",
    passed: false,
    memoryEligible: true,
    acceptedStatus: "completed"
  }),
  "retry",
  "真正的無提示失敗才可標成需要重刷"
);

const cleanEvent = {
  id: "clean",
  problemId: "clean-card",
  submittedAt: "2026-07-20T00:00:00.000Z",
  passed: true,
  durationMs: 1_000,
  inferredRating: "good",
  memoryEligible: true
};
const assistedEvent = {
  id: "assisted",
  problemId: "assisted-card",
  submittedAt: "2026-07-20T00:00:00.000Z",
  passed: true,
  durationMs: 1_000,
  inferredRating: "hard",
  answerRevealCount: 1
};
const timeoutAt = new Date("2026-07-21T00:00:00.000Z");
const repair = rebuildMemoryCards(
  {
    "clean-card": {
      status: "completed",
      attempts: 1,
      passed: 1,
      failed: 0,
      hints: 0,
      streak: 1,
      totalMs: 1_000,
      fsrs: scheduleReview(
        undefined,
        "good",
        new Date(cleanEvent.submittedAt)
      )
    },
    "assisted-card": {
      status: "completed",
      attempts: 1,
      passed: 1,
      failed: 0,
      hints: 0,
      streak: 1,
      totalMs: 1_000,
      fsrs: scheduleReview(
        undefined,
        "hard",
        new Date(assistedEvent.submittedAt)
      )
    },
    "timeout-card": {
      status: "retry",
      attempts: 0,
      passed: 0,
      failed: 0,
      hints: 0,
      streak: 0,
      totalMs: 0,
      fsrs: scheduleReview(undefined, "again", timeoutAt)
    }
  },
  [cleanEvent, assistedEvent]
);
assert.equal(repair.records["clean-card"].fsrs?.last_rating, "good");
assert.equal(
  repair.records["assisted-card"].fsrs?.last_rating,
  "hard",
  "重建是補強不取代：無可重放證據時必須保留既有 FSRS 卡"
);
assert.equal(
  repair.records["timeout-card"].fsrs?.last_rating,
  "again",
  "沒有提交事件可回指時只記錄差異，不可刪除既有排程"
);
assert.equal(repair.report.assistedEvents, 1);
assert.equal(repair.report.clearedCards, 0);
assert.equal(repair.report.discardedUnmatchedReviews, 2);
assert.equal(repair.report.rebuiltCards, 1);

// 回歸測試：schema 升版重跑 rebuildMemoryCards 時，舊事件沒有
// inferredRating（或歷史被 20000 筆上限截斷）的題目，既有 FSRS
// 排程必須原封不動保留，不可歸零。
const legacyFsrs = scheduleReview(
  undefined,
  "good",
  new Date("2026-06-01T00:00:00.000Z")
);
const legacyRepair = rebuildMemoryCards(
  {
    "legacy-card": {
      status: "completed",
      attempts: 3,
      passed: 3,
      failed: 0,
      hints: 0,
      streak: 3,
      totalMs: 3_000,
      fsrs: legacyFsrs
    }
  },
  [
    {
      id: "legacy-pass",
      problemId: "legacy-card",
      submittedAt: "2026-06-01T00:00:00.000Z",
      passed: true,
      durationMs: 1_000,
      memoryEligible: true
      // 舊版事件沒有 inferredRating 欄位
    }
  ]
);
assert.deepEqual(
  legacyRepair.records["legacy-card"].fsrs,
  legacyFsrs,
  "舊事件缺 inferredRating 時，既有 FSRS 卡必須完整保留"
);
assert.equal(
  legacyRepair.records["legacy-card"].status,
  "completed",
  "保留既有卡片時不可順手降級狀態"
);
assert.equal(legacyRepair.report.clearedCards, 0);

console.log("記憶證據測試通過：Repeat、答案跟打與 Speed 重打不會污染 FSRS。");
