import assert from "node:assert/strict";

const {
  buildDailyTrainingPlan,
  currentTrainingBlock,
  emptyTrainingProgram,
  nextTrainingDay,
  normalizeTrainingProgram,
  pauseTrainingPlan,
  recordTrainingProblemOutcome,
  rolloverIncompleteTrainingPlan,
  startTrainingBlock,
  syncTrainingPlanQueue,
  trainingPlanForDate,
  trainingPhaseForDay,
  trainingProgramWithCompletedPlan
} = await import("../lib/trainingPlan.ts");

const now = new Date("2026-07-27T08:00:00.000Z");

function problem(id, category, options = {}) {
  return {
    id,
    order: Number(id.replace(/\D/g, "")) || 1,
    identity: id,
    title: id,
    category,
    difficulty: options.difficulty ?? "medium",
    sources: options.sources ?? ["Core 75"],
    testCount: options.testCount ?? 2,
    runnable: options.runnable ?? true
  };
}

function record(overrides = {}) {
  return {
    status: "new",
    attempts: 0,
    passed: 0,
    memoryPassed: 0,
    assistedPassed: 0,
    failed: 0,
    hints: 0,
    streak: 0,
    totalMs: 0,
    ...overrides
  };
}

function dueCard(overrides = {}) {
  return {
    algorithm_version: 7,
    due: "2026-07-26T00:00:00.000Z",
    stability: 1,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 1,
    learning_steps: 0,
    reps: 1,
    lapses: 0,
    state: 2,
    last_review: "2026-07-25T00:00:00.000Z",
    ...overrides
  };
}

const problems = [
  problem("review-array", "陣列與 Hash"),
  problem("review-tree", "二元樹與 BST"),
  problem("speed-array", "陣列與 Hash"),
  problem("speed-tree", "二元樹與 BST"),
  problem("speed-graph", "圖"),
  problem("assisted-array", "陣列與 Hash"),
  problem("new-array-1", "陣列與 Hash"),
  problem("new-array-2", "陣列與 Hash"),
  problem("new-array-3", "陣列與 Hash"),
  problem("new-pointer", "雙指標"),
  problem("hard-array", "陣列與 Hash", { difficulty: "hard" }),
  problem("external-only", "陣列與 Hash", { sources: ["External list"] }),
  problem("no-tests", "陣列與 Hash", { testCount: 0 })
];

const records = {
  "review-array": record({
    status: "completed",
    attempts: 2,
    passed: 1,
    memoryPassed: 1,
    fsrs: dueCard()
  }),
  "review-tree": record({
    status: "retry",
    attempts: 2,
    failed: 2,
    fsrs: dueCard()
  }),
  "speed-array": record({
    status: "completed",
    attempts: 2,
    passed: 1,
    memoryPassed: 1,
    fsrs: dueCard()
  }),
  "speed-tree": record({
    status: "completed",
    attempts: 2,
    passed: 1,
    memoryPassed: 1,
    fsrs: dueCard()
  }),
  "speed-graph": record({
    status: "completed",
    attempts: 2,
    passed: 1,
    memoryPassed: 1,
    fsrs: dueCard()
  }),
  "assisted-array": record({
    status: "learning",
    attempts: 1,
    passed: 1,
    memoryPassed: 0,
    assistedPassed: 1
  })
};

const program = emptyTrainingProgram();
const plan = buildDailyTrainingPlan({
  problems,
  records,
  program,
  preset: "standard",
  now,
  random: () => 0.25
});

assert.ok(plan);
assert.equal(plan.planDay, 1);
assert.equal(plan.phase, "foundation");
assert.deepEqual(plan.focusCategories, ["陣列與 Hash"]);
assert.ok(
  plan.blocks.some((block) => block.kind === "recall"),
  "每日菜單必須先安排已到期的舊題"
);
assert.ok(
  plan.blocks.some((block) => block.kind === "learn"),
  "每日菜單必須安排今日主題的新題"
);

const allIds = plan.blocks.flatMap((block) => block.problemIds);
assert.equal(
  new Set(allIds).size,
  allIds.length,
  "同一份每日菜單不可重複抽到同一題"
);
assert.equal(allIds.includes("hard-array"), false);
assert.equal(allIds.includes("external-only"), false);
assert.equal(allIds.includes("no-tests"), false);

const speedOnlyIds = [
  "speed-only-1",
  "speed-only-2",
  "speed-only-3",
  "speed-only-4"
];
const speedOnlyRecords = Object.fromEntries(
  speedOnlyIds.map((id) => [
    id,
    record({
      status: "completed",
      attempts: 1,
      passed: 1,
      memoryPassed: 1,
      fsrs: dueCard()
    })
  ])
);
const speedPlan = buildDailyTrainingPlan({
  problems: [
    problem("speed-only-1", "陣列與 Hash"),
    problem("speed-only-2", "雙指標"),
    problem("speed-only-3", "圖"),
    problem("speed-only-4", "二元樹與 BST")
  ],
  records: speedOnlyRecords,
  program,
  preset: "light",
  now,
  random: () => 0.25
});
const speedBlock = speedPlan?.blocks.find(
  (item) => item.kind === "speed"
);
assert.ok(
  speedBlock,
  "有足夠的已獨立 AC 到期題時，必須建立 Speed 區塊"
);
assert.ok(
  speedBlock.problemIds.every(
    (id) => (speedOnlyRecords[id]?.memoryPassed ?? 0) > 0
  ),
  "Speed 只能使用曾經獨立 AC 的到期題"
);

const assistedRecallPlan = buildDailyTrainingPlan({
  problems: [
    problem("assisted-only", "陣列與 Hash"),
    problem("fresh-only", "陣列與 Hash")
  ],
  records: {
    "assisted-only": record({
      status: "learning",
      attempts: 1,
      passed: 1,
      assistedPassed: 1
    })
  },
  program,
  preset: "light",
  now,
  random: () => 0
});
assert.ok(
  assistedRecallPlan?.blocks
    .find((item) => item.kind === "recall")
    ?.problemIds.includes("assisted-only"),
  "看答案才 AC 的題目必須回到提取區塊，不能被誤認成已學會"
);

const started = startTrainingBlock(plan);
assert.equal(started.status, "running");
assert.equal(currentTrainingBlock(started)?.status, "running");
const active = currentTrainingBlock(started);
assert.ok(active);
const paused = pauseTrainingPlan(started);
assert.equal(paused?.status, "paused");
assert.equal(
  syncTrainingPlanQueue(paused, [], active.mode, now),
  paused,
  "暫停期間即使外部佇列清空，也不可誤完成訓練區塊"
);
const resumed = startTrainingBlock(paused);
assert.deepEqual(
  currentTrainingBlock(resumed)?.remainingProblemIds,
  active.remainingProblemIds,
  "恢復每日訓練時必須從原本未完成題目繼續"
);
assert.equal(
  syncTrainingPlanQueue(
    started,
    [],
    active.mode === "free" ? "guided" : "free",
    now
  ),
  started,
  "模式不符時不可誤完成每日訓練區塊"
);
assert.equal(
  syncTrainingPlanQueue(started, ["outside-plan"], active.mode, now),
  started,
  "外部題目佇列不可污染每日訓練進度"
);
const partiallyDone = syncTrainingPlanQueue(
  started,
  active.problemIds.slice(1),
  active.mode,
  now
);
assert.deepEqual(
  currentTrainingBlock(partiallyDone)?.remainingProblemIds,
  [...active.problemIds.slice(1), active.problemIds[0]],
  "畫面切掉第一題只能調整順序，不可把它冒充成完成"
);
const blockDone = syncTrainingPlanQueue(
  partiallyDone,
  [],
  active.mode,
  now
);
assert.equal(
  blockDone.blocks[0].status,
  "running",
  "queue 清空是導覽狀態，不是作答證據，絕不可完成區塊"
);
assert.deepEqual(
  currentTrainingBlock(blockDone)?.remainingProblemIds,
  currentTrainingBlock(partiallyDone)?.remainingProblemIds
);

const activeId = active.remainingProblemIds[0];
assert.equal(
  recordTrainingProblemOutcome(started, {
    mode: active.mode,
    activeProblemId: activeId,
    outcome: "completed"
  }),
  started,
  "沒有 completedProblemId 的事件不可推進 Daily Training"
);
assert.equal(
  recordTrainingProblemOutcome(started, {
    mode: active.mode,
    activeProblemId: activeId,
    completedProblemId: "different-problem",
    outcome: "completed"
  }),
  started,
  "非目前題目的完成事件不可推進 Daily Training"
);
const skippedTrainingProblem = recordTrainingProblemOutcome(started, {
  mode: active.mode,
  activeProblemId: activeId,
  outcome: "skipped"
});
assert.equal(
  currentTrainingBlock(skippedTrainingProblem)?.remainingProblemIds.at(-1),
  activeId,
  "跳過只能移到尾端，題目仍必須保持未完成"
);
assert.equal(currentTrainingBlock(skippedTrainingProblem)?.status, "running");
const abandoned = recordTrainingProblemOutcome(started, {
  mode: active.mode,
  activeProblemId: activeId,
  outcome: "abandoned"
});
assert.equal(abandoned.status, "paused");
assert.deepEqual(
  currentTrainingBlock(abandoned)?.remainingProblemIds,
  active.remainingProblemIds,
  "半途離開必須保留完整的未完成清單"
);

if (plan.blocks.length > 1) {
  let outOfOrder = startTrainingBlock(plan, plan.blocks.length - 1);
  const lastBlock = currentTrainingBlock(outOfOrder);
  assert.ok(lastBlock);
  for (const problemId of [...lastBlock.remainingProblemIds]) {
    outOfOrder = recordTrainingProblemOutcome(outOfOrder, {
      mode: lastBlock.mode,
      activeProblemId: problemId,
      completedProblemId: problemId,
      outcome: "completed",
      occurredAt: now
    });
  }
  assert.notEqual(
    outOfOrder.status,
    "completed",
    "先完成最後一個區塊時，前面未完成區塊仍必須保留"
  );
  assert.equal(
    currentTrainingBlock(outOfOrder)?.status,
    "pending",
    "亂序完成後必須回到真正尚未完成的區塊"
  );
}

let finished = started;
for (let index = 0; index < started.blocks.length; index += 1) {
  finished = startTrainingBlock(finished, index);
  const trainingBlock = currentTrainingBlock(finished);
  assert.ok(trainingBlock);
  for (const problemId of [...trainingBlock.remainingProblemIds]) {
    finished = recordTrainingProblemOutcome(finished, {
      mode: trainingBlock.mode,
      activeProblemId: problemId,
      completedProblemId: problemId,
      outcome: "completed",
      occurredAt: now
    });
  }
}
assert.equal(finished.status, "completed");
const completedProgram = trainingProgramWithCompletedPlan(program, finished);
assert.equal(completedProgram.completedDays[plan.date].planDay, 1);
assert.equal(nextTrainingDay(completedProgram), 2);

const oldPausedProgram = {
  ...program,
  activePlan: {
    ...paused,
    date: "2026-07-26",
    planDay: 1
  }
};
assert.equal(
  trainingPlanForDate(oldPausedProgram, "2026-07-27")?.date,
  "2026-07-27",
  "昨天未完成的菜單必須滾到今天，不能靜默丟掉"
);
assert.equal(
  trainingPlanForDate(oldPausedProgram, "2026-07-27")?.status,
  "paused",
  "跨日續做必須先保持暫停，不能背景自動開始"
);
assert.equal(
  nextTrainingDay(oldPausedProgram, now),
  1,
  "只開始或半途離開 Day 1 不可假裝完成並推進 Day 2"
);
const rolledPlan = buildDailyTrainingPlan({
  problems,
  records,
  program: oldPausedProgram,
  preset: "standard",
  now,
  random: () => 0.25
});
assert.equal(rolledPlan?.planDay, 1);
const carriedPlan = rolloverIncompleteTrainingPlan(
  oldPausedProgram.activePlan,
  "2026-07-27"
);
assert.equal(carriedPlan?.planDay, 1);
assert.deepEqual(
  currentTrainingBlock(carriedPlan)?.remainingProblemIds,
  currentTrainingBlock(oldPausedProgram.activePlan)?.remainingProblemIds,
  "跨日續做必須保留真正未完成的題目"
);

assert.equal(trainingPhaseForDay(7), "foundation");
assert.equal(trainingPhaseForDay(8), "patterns");
assert.equal(trainingPhaseForDay(15), "transfer");
assert.equal(trainingPhaseForDay(22), "interview");

const normalized = normalizeTrainingProgram({
  preset: "intensive",
  startedOn: "2026-07-27",
  activePlan: started,
  completedDays: {}
});
assert.equal(normalized.preset, "intensive");
assert.equal(normalized.activePlan?.status, "running");
assert.deepEqual(
  normalizeTrainingProgram(null),
  emptyTrainingProgram(),
  "舊資料沒有 training 時必須安全補上預設菜單"
);

const recordsSnapshot = structuredClone(records);
buildDailyTrainingPlan({
  problems,
  records,
  program,
  preset: "light",
  now,
  random: () => 0.5
});
assert.deepEqual(
  records,
  recordsSnapshot,
  "產生菜單只能選題，不得改寫任何 FSRS 或作答紀錄"
);

console.log(
  "每日特訓菜單測試通過：30 日階段、到期優先、題目去重、Speed 閘門與 FSRS 唯讀。"
);
