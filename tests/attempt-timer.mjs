import assert from "node:assert/strict";

import {
  attemptElapsedMs,
  beginOrResumeAttempt,
  emptyAttemptTimer,
  pauseAttempt
} from "../lib/attemptTimer.ts";

let timer = emptyAttemptTimer();
assert.equal(attemptElapsedMs(timer, 50_000), 0);

timer = beginOrResumeAttempt(timer, 1_000);
assert.equal(attemptElapsedMs(timer, 4_500), 3_500);

timer = pauseAttempt(timer, 5_000);
assert.equal(attemptElapsedMs(timer, 9_000), 4_000);

timer = beginOrResumeAttempt(timer, 10_000);
assert.equal(attemptElapsedMs(timer, 11_500), 5_500);

timer = emptyAttemptTimer();
assert.equal(timer.started, false);
assert.equal(attemptElapsedMs(timer, 99_000), 0);

console.log(
  "作答計時測試通過：首次輸入開始、暫停不偷跑、繼續累加、重置歸零。"
);
