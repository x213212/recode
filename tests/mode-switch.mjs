import assert from "node:assert/strict";

const {
  practiceModeSwitchPolicy,
  queueAfterPreservedModeSwitch
} = await import("../lib/review.ts");

assert.equal(
  practiceModeSwitchPolicy("guided", "free").preserveCurrentProblem,
  true,
  "引導切自由不應中斷目前題目"
);
assert.equal(
  practiceModeSwitchPolicy("free", "guided").preserveCurrentProblem,
  true,
  "自由切引導不應中斷目前題目"
);
assert.equal(
  practiceModeSwitchPolicy("guided", "explore").preserveCurrentProblem,
  true,
  "探險只重排後續已解題，也不應中斷目前題目"
);
assert.equal(
  practiceModeSwitchPolicy("explore", "free").preserveCurrentProblem,
  true,
  "離開探險回自由時仍應保留目前題目"
);
assert.equal(
  practiceModeSwitchPolicy("guided", "speed").preserveCurrentProblem,
  false,
  "Speed 有獨立計時與計分，必須建立新回合"
);
assert.equal(
  practiceModeSwitchPolicy("free", "interview").preserveCurrentProblem,
  false,
  "模擬面試有獨立計時，必須建立新回合"
);

const allModes = [
  "guided",
  "free",
  "explore",
  "interview",
  "speed",
  "repeat"
];
for (const currentMode of allModes) {
  for (const nextMode of allModes) {
    assert.equal(
      practiceModeSwitchPolicy(currentMode, nextMode).memoryEvidence,
      "none",
      `${currentMode} → ${nextMode} 不可被當成一次記憶測驗`
    );
  }
}

const ordered = ["due-1", "current", "due-2", "new-1"];
const switchedQueue = queueAfterPreservedModeSwitch(
  "current",
  ordered,
  3
);
assert.deepEqual(
  switchedQueue,
  ["current", "due-1", "due-2"],
  "目前題目留在第一格，新模式只重排後續題目"
);
assert.deepEqual(
  ordered,
  ["due-1", "current", "due-2", "new-1"],
  "模式切換不可原地修改候選題組"
);
assert.deepEqual(
  queueAfterPreservedModeSwitch("current", ordered, 0),
  ["current", "due-1", "due-2", "new-1"],
  "全部題目模式仍不可重複加入目前題目"
);
assert.deepEqual(
  queueAfterPreservedModeSwitch("current", ordered, 1),
  ["current"],
  "sessionSize 包含正在作答的目前題目"
);

console.log(
  "模式切換測試通過：連續模式保留目前題目，所有模式切換都不產生記憶證據。"
);
