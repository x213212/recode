import assert from "node:assert/strict";

const {
  REPEAT_REVEAL_LEVELS,
  REPEAT_CHECKPOINT_DELAY_MS,
  emptyRepeatSession,
  isFinalRepeatStage,
  isRepeatCheckpointDue,
  nextRepeatStage,
  normalizeRepeatSession,
  repeatCheckpointDue,
  repeatRevealPercent,
  repeatSubmissionTransition
} = await import("../lib/repeatMode.ts");

assert.deepEqual(REPEAT_REVEAL_LEVELS, [100, 75, 50]);
assert.equal(repeatRevealPercent(0), 100);
assert.equal(repeatRevealPercent(1), 75);
assert.equal(repeatRevealPercent(2), 50);
assert.equal(repeatRevealPercent(99), 50);
assert.equal(nextRepeatStage(0), 1);
assert.equal(nextRepeatStage(1), 2);
assert.equal(nextRepeatStage(2), 2);
assert.equal(isFinalRepeatStage(1), false);
assert.equal(isFinalRepeatStage(2), true);
assert.deepEqual(emptyRepeatSession(), {
  phase: "idle",
  stage: 0,
  total: 0,
  completed: 0,
  failedStages: 0,
  stageFailures: 0
});
assert.deepEqual(
  normalizeRepeatSession({
    phase: "running",
    stage: 2,
    total: 8,
    completed: 3,
    failedStages: 1
  }),
  {
    phase: "running",
    stage: 2,
    total: 8,
    completed: 3,
    failedStages: 1,
    // 舊存檔沒有 stageFailures 欄位時必須安全補 0。
    stageFailures: 0
  },
  "關閉瀏覽器後必須能還原 Repeat 的題目輪次"
);

const running = {
  ...emptyRepeatSession(),
  phase: "running",
  total: 2
};
const failed = repeatSubmissionTransition(running, false);
assert.equal(failed.session.stage, 0);
assert.equal(failed.session.failedStages, 1);
assert.equal(failed.session.stageFailures, 1);
assert.equal(failed.advanceProblem, false);
assert.equal(failed.resetEditor, false);
assert.equal(failed.stagePassed, false);

// 同一階段連續失敗達 3 次：強制前進下一題並標記該階段未通過，
// 避免 Repeat 回合被同一題無限卡死。
const secondFailure = repeatSubmissionTransition(
  failed.session,
  false
);
assert.equal(secondFailure.session.stageFailures, 2);
assert.equal(secondFailure.advanceProblem, false);
const forcedAdvance = repeatSubmissionTransition(
  secondFailure.session,
  false
);
assert.equal(forcedAdvance.advanceProblem, true);
assert.equal(forcedAdvance.resetEditor, true);
assert.equal(
  forcedAdvance.stagePassed,
  false,
  "被放行的階段必須標記為未通過，不可冒充成功"
);
assert.equal(forcedAdvance.session.stage, 0);
assert.equal(forcedAdvance.session.stageFailures, 0);
assert.equal(
  forcedAdvance.session.failedStages,
  3,
  "強制前進仍須照實累計失敗次數"
);
assert.equal(
  forcedAdvance.session.completed,
  1,
  "強制前進也要推進回合進度，回合才不會永遠結束不了"
);

const firstAccepted = repeatSubmissionTransition(running, true);
assert.equal(firstAccepted.session.stage, 1);
assert.equal(firstAccepted.advanceProblem, false);
assert.equal(firstAccepted.resetEditor, true);
assert.equal(firstAccepted.stagePassed, true);

const secondAccepted = repeatSubmissionTransition(
  firstAccepted.session,
  true
);
assert.equal(secondAccepted.session.stage, 2);
assert.equal(secondAccepted.advanceProblem, false);

const finalAccepted = repeatSubmissionTransition(
  secondAccepted.session,
  true
);
assert.equal(finalAccepted.session.stage, 0);
assert.equal(finalAccepted.session.completed, 1);
assert.equal(finalAccepted.advanceProblem, true);
assert.equal(finalAccepted.stagePassed, true);

// 失敗一次後通過：進入下一階段時，本階段失敗計數必須重新起算。
const recoveredStage = repeatSubmissionTransition(
  failed.session,
  true
);
assert.equal(recoveredStage.session.stage, 1);
assert.equal(recoveredStage.session.stageFailures, 0);

const completedAt = new Date("2026-07-27T08:00:00.000Z");
const checkpoint = repeatCheckpointDue(completedAt);
assert.equal(
  Date.parse(checkpoint) - completedAt.getTime(),
  REPEAT_CHECKPOINT_DELAY_MS
);
assert.equal(
  isRepeatCheckpointDue(
    checkpoint,
    new Date("2026-07-27T08:29:59.999Z")
  ),
  false,
  "引導重建完成後不可立刻冒充延遲回想"
);
assert.equal(
  isRepeatCheckpointDue(
    checkpoint,
    new Date("2026-07-27T08:30:00.000Z")
  ),
  true,
  "30 分鐘後才開放 0% 提示獨立驗收"
);

console.log("Repeat 模式測試通過：三段引導後會延遲安排 0% 提示驗收。");
