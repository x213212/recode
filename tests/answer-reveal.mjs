import assert from "node:assert/strict";

const {
  adaptiveAnswerPercent,
  answerDisplayPolicy,
  answerLineForCompletion,
  answerScrollPaddingColumns,
  answerScrollPaddingLines,
  buildRevealedAnswer,
  normalizeAnswerPercent
} = await import("../lib/answerReveal.ts");

assert.deepEqual(
  answerDisplayPolicy({
    canReveal: true,
    answerOpen: true,
    comparisonOpen: false,
    forceOverlay: false,
    hasAnswer: true
  }),
  {
    overlayVisible: true,
    comparisonVisible: false
  },
  "沒有開並排對照時，答案仍必須作為半透明底稿顯示"
);
assert.deepEqual(
  answerDisplayPolicy({
    canReveal: true,
    answerOpen: true,
    comparisonOpen: true,
    forceOverlay: false,
    hasAnswer: true
  }),
  {
    overlayVisible: true,
    comparisonVisible: true
  },
  "並排對照只能改變答案呈現方式，不能取代答案底稿狀態"
);
assert.deepEqual(
  answerDisplayPolicy({
    canReveal: true,
    answerOpen: false,
    comparisonOpen: true,
    forceOverlay: true,
    hasAnswer: true
  }),
  {
    overlayVisible: true,
    comparisonVisible: false
  },
  "Repeat 強迫提示必須顯示底稿，但不能被舊的並排狀態污染"
);
assert.deepEqual(
  answerDisplayPolicy({
    canReveal: false,
    answerOpen: true,
    comparisonOpen: true,
    forceOverlay: false,
    hasAnswer: true
  }),
  {
    overlayVisible: false,
    comparisonVisible: false
  },
  "面試或 Speed 尚未允許揭露時，兩種答案呈現都必須鎖住"
);

const answer = [
  "class Solution:",
  "    def solve(self, nums):",
  "        first = nums[0]",
  "        second = nums[1]",
  "        third = nums[2]",
  "        fourth = nums[3]",
  "        fifth = nums[4]",
  "        return first + second + third + fourth + fifth"
].join("\n");

assert.equal(
  buildRevealedAnswer(answer, "full", 30, "lc-test", 0),
  answer
);
assert.equal(
  buildRevealedAnswer(answer, "random", 100, "lc-test", 0),
  answer
);

const firstDraw = buildRevealedAnswer(
  answer,
  "random",
  30,
  "lc-test",
  0
);
const repeatedDraw = buildRevealedAnswer(
  answer,
  "random",
  30,
  "lc-test",
  0
);
const nextDraw = buildRevealedAnswer(
  answer,
  "random",
  30,
  "lc-test",
  1
);

assert.equal(firstDraw, repeatedDraw, "同一 seed 不可在輸入時亂跳");
assert.notEqual(firstDraw, nextDraw, "重抽必須換一組片段");
assert.equal(firstDraw.split("\n").length, answer.split("\n").length);
assert.equal(firstDraw.split("\n")[0], "class Solution:");
assert.equal(firstDraw.split("\n")[1], "    def solve(self, nums):");
assert.equal(normalizeAnswerPercent(33), 30);
assert.equal(normalizeAnswerPercent(200), 100);
assert.equal(normalizeAnswerPercent(0), 10);
assert.equal(adaptiveAnswerPercent(0), 100);
assert.equal(adaptiveAnswerPercent(1), 75);
assert.equal(adaptiveAnswerPercent(2), 50);
assert.equal(adaptiveAnswerPercent(5), 10);
assert.equal(adaptiveAnswerPercent(100), 10);
assert.equal(
  adaptiveAnswerPercent({
    successfulSubmissions: 4,
    status: "retry"
  }),
  75,
  "剛失敗的題目要暫時把提示量拉回來"
);
assert.equal(
  adaptiveAnswerPercent({
    successfulSubmissions: 4,
    recentFailedSubmissions: 1
  }),
  75,
  "目前這一輪剛失敗時要提高提示"
);
assert.equal(
  adaptiveAnswerPercent({
    successfulSubmissions: 4,
    recentFailedSubmissions: 0,
    status: "completed",
    retrievability: 0.9
  }),
  10,
  "很久以前的錯誤不可永久卡住答案比例"
);
assert.equal(
  adaptiveAnswerPercent({
    successfulSubmissions: 4,
    retrievability: 0.4
  }),
  50,
  "FSRS 顯示快忘記時，不應直接只留 10%"
);
assert.equal(
  answerLineForCompletion(answer, 3),
  "        first = nums[0]"
);
assert.equal(
  answerLineForCompletion("class Solution:\n                  \n", 2),
  undefined,
  "隱藏的答案行不可被 Option+Enter 偷偷補入"
);
assert.equal(answerLineForCompletion(answer, 99), undefined);
assert.equal(
  answerScrollPaddingColumns("1234567890", "1234"),
  11,
  "尚未輸入時，主 editor 必須補足解答比骨架多出的 6 欄，再保留 5 欄緩衝"
);
assert.equal(
  answerScrollPaddingColumns("1234", "1234567890"),
  5,
  "目前程式已比解答更長時，只保留 Monaco 原本的最小緩衝"
);
assert.equal(
  answerScrollPaddingLines("1\n2\n3\n4\n5", "1\n2"),
  5,
  "答案比骨架多三行時，主 editor 必須多出三行加兩行緩衝"
);
assert.ok(
  Array.from({ length: 20 }, (_, index) => adaptiveAnswerPercent(index)).every(
    (percent, index, values) => index === 0 || percent <= values[index - 1]
  ),
  "答案顯示比例必須隨本題 AC 次數單調下降"
);

console.log(
  "答案揭露測試通過：完整、百分比、固定隨機片段、AC 漸隱與 Option+Enter 單行補全。"
);
