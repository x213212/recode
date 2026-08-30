import assert from "node:assert/strict";

import { scheduleReview } from "../lib/fsrs.ts";
import {
  SPEED_QUESTION_LIMIT_MS,
  emptySpeedSession,
  nextSpeedCategoryStats,
  normalizeSpeedSession,
  normalizeSpeedQuestionSeconds,
  speedAnswerPolicy,
  speedQuestionLimitMs,
  speedQueue,
  speedScore,
  speedSubmissionCanAdvance,
  speedTimerTone
} from "../lib/speedMode.ts";

const now = new Date("2026-07-26T00:00:00.000Z");
const overdue = scheduleReview(undefined, "good", new Date("2026-07-01T00:00:00.000Z"));
const future = scheduleReview(undefined, "easy", now);
const problems = [
  { id: "new", order: 1 },
  { id: "future", order: 2 },
  { id: "overdue", order: 3 }
];

assert.deepEqual(
  speedQueue(problems, { overdue: { fsrs: overdue }, future: { fsrs: future } }, 2, now).map(
    (problem) => problem.id
  ),
  ["overdue", "new"],
  "Speed Mode 必須先抽 FSRS 已到期卡，再補新題"
);
assert.deepEqual(
  speedQueue(
    [{ id: "future", order: 1 }],
    { future: { fsrs: future } },
    20,
    now
  ),
  [],
  "只有尚未到期卡時 Speed 不可為了湊題數提前抽題"
);

// 預設限時 60 → 300 秒：60 秒寫完一題不現實，色條門檻改依 300 秒基準。
assert.equal(speedTimerTone(200_000), "safe");
assert.equal(speedTimerTone(120_000), "warning");
assert.equal(speedTimerTone(45_000), "danger");
assert.equal(speedTimerTone(0), "danger");
assert.equal(normalizeSpeedQuestionSeconds(undefined), 300);
assert.equal(normalizeSpeedQuestionSeconds(90.4), 90);
assert.equal(normalizeSpeedQuestionSeconds(1), 10);
assert.equal(normalizeSpeedQuestionSeconds(9999), 600);
assert.equal(speedQuestionLimitMs(90), 90_000);
assert.equal(speedTimerTone(45_000, 90_000), "warning");

assert.equal(speedScore("easy", 0), 100);
assert.equal(speedScore("easy", SPEED_QUESTION_LIMIT_MS), 200);
assert.equal(speedScore("easy", 90_000, 90_000), 200);
assert.ok(
  speedScore("hard", 30_000) > speedScore("medium", 30_000),
  "較難題的分數應反映難度"
);

const category = nextSpeedCategoryStats({}, "BFS", {
  solved: 1,
  points: 190
});
const updated = nextSpeedCategoryStats(category, "BFS", {
  timedOut: 1,
  wrongAttempts: 2
});
assert.deepEqual(updated.BFS, {
  solved: 1,
  timedOut: 1,
  wrongAttempts: 2,
  points: 190
});
assert.deepEqual(emptySpeedSession(), {
  phase: "setup",
  // 預設限時同步改為 300 秒。
  questionLimitMs: 300_000,
  total: 0,
  score: 0,
  solved: 0,
  timedOut: 0,
  wrongAttempts: 0,
  categories: {}
});
assert.deepEqual(
  normalizeSpeedSession({
    phase: "running",
    questionLimitMs: 90_000,
    total: 5,
    score: 120,
    solved: 1,
    timedOut: 0,
    wrongAttempts: 2,
    deadlineAt: 1_800_000_000_000,
    questionId: "lc-1",
    categories: {
      Array: {
        solved: 1,
        timedOut: 0,
        wrongAttempts: 2,
        points: 120
      }
    }
  }).questionId,
  "lc-1",
  "關閉瀏覽器後必須能還原 Speed 目前題目與 deadline"
);
assert.equal(emptySpeedSession(90_000).questionLimitMs, 90_000);
assert.deepEqual(speedAnswerPolicy(false), {
  answerOpen: false,
  answerReferenceOpen: false,
  explanationOpen: false
});
assert.deepEqual(speedAnswerPolicy(true), {
  answerOpen: true,
  answerReferenceOpen: true,
  explanationOpen: false
});
assert.equal(
  speedSubmissionCanAdvance({
    submittedInTime: true,
    timeoutRewrite: false,
    solutionVisible: false
  }),
  true
);
assert.equal(
  speedSubmissionCanAdvance({
    submittedInTime: false,
    timeoutRewrite: true,
    solutionVisible: false
  }),
  true
);
assert.equal(
  speedSubmissionCanAdvance({
    submittedInTime: false,
    timeoutRewrite: false,
    solutionVisible: true
  }),
  true
);
assert.equal(
  speedSubmissionCanAdvance({
    submittedInTime: false,
    timeoutRewrite: false,
    solutionVisible: false
  }),
  false,
  "隱藏答案且逾時後才送出，即使程式正確也不可略過逾時重打"
);

console.log("Speed Mode 規則測試通過：FSRS 選題、分數、色條與分類統計。");
