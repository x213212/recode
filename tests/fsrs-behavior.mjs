import assert from "node:assert/strict";

import {
  FSRS_ALGORITHM_VERSION,
  FSRS_DESIRED_RETENTION,
  FSRS_SCHEDULER_REVISION,
  FSRS7_REFERENCE,
  familiarityLabel,
  fsrs7IntervalForRetention,
  fsrs7Retrievability,
  isDue,
  retrievability,
  scheduleReview
} from "../lib/fsrs.ts";
import {
  advancePracticeQueue,
  assessAcceptedSubmission,
  diversifiedSessionProblems,
  diversifiedGuidedSessionProblems,
  explorationPool,
  insertDueReviewsAfterCurrent,
  interleaveProblemCategories,
  matchesDifficultyFilter,
  matchesProblemLibraryQuery,
  mergeDueReviewsIntoQueue,
  orderProblemsForReview,
  problemLibraryRank,
  ratingForAcceptedSubmission,
  recordAfterSkipping,
  rememberPracticeProblem,
  reviewSessionProblems,
  restorePreviousPracticeProblem,
  statusAfterLeavingEditedProblem,
  statusAfterResettingProblem
} from "../lib/review.ts";

const start = new Date("2026-07-25T00:00:00.000Z");
const ratings = ["again", "hard", "good", "easy"];
const firstCards = Object.fromEntries(
  ratings.map((rating) => [rating, scheduleReview(undefined, rating, start)])
);

const firstDue = ratings.map((rating) =>
  new Date(firstCards[rating].due).getTime()
);
const minute = 60 * 1000;
const day = 24 * 60 * minute;
// 學習步改為單步 1440 分鐘：寫一題要 15~30 分鐘，10/30 分鐘的背單字
// 學習步只會讓同一題當天跳針。Again 隔天重練、Hard 為單步的 1.5 倍。
assert.equal(firstDue[0] - start.getTime(), 1440 * minute);
assert.equal(firstDue[1] - start.getTime(), 2160 * minute);
// 單步陣列下首次 Good 直接畢業進入長期排程（0.90 保留率反推約 3 天）。
assert.ok(
  firstDue[2] - start.getTime() >= 2 * day &&
    firstDue[2] - start.getTime() <= 5 * day,
  "首次 Good 應畢業為數天級的長期間隔，而不是 30 分鐘"
);
assert.ok(
  Object.values(firstCards).every(
    (card) => card.scheduler_revision === FSRS_SCHEDULER_REVISION
  ),
  "同為 FSRS-7 也必須保存精確公式／參數修訂"
);
assert.equal(
  firstCards.good.state,
  2,
  "單步學習下首次 Good 必須直接畢業成 Review 卡"
);
assert.ok(
  firstDue.every((due, index) => index === 0 || due > firstDue[index - 1]),
  "新卡的 Again、Hard、Good、Easy 應依序安排得更晚"
);
assert.ok(
  Object.values(firstCards).every(
    (card) => card.algorithm_version === FSRS_ALGORITHM_VERSION
  ),
  "所有新排程都必須寫入 FSRS-7 版本，避免和舊模型混算"
);
// 0.95 是背單字保留率，會把間隔壓短 30~50%；刷題採 FSRS 標準 0.90。
assert.equal(FSRS_DESIRED_RETENTION, 0.9);
assert.ok(
  Math.abs(
    fsrs7Retrievability(
      fsrs7IntervalForRetention(firstCards.good.stability),
      firstCards.good.stability
    ) - FSRS_DESIRED_RETENTION
  ) < 0.000001,
  "由 FSRS-7 遺忘曲線反推的間隔，記憶率應落在目標保留率"
);

// Golden vectors calculated independently from the pinned Python equations
// and the published default parameter table.  These exact values prevent a
// local formula tweak from passing tests that merely repeat its own logic.
assert.equal(
  FSRS7_REFERENCE.commit,
  "1053082bd2d6dbedbbd9674c4c9683c203f6818a"
);
const assertClose = (actual, expected, label, tolerance = 1e-12) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`
  );
};
assertClose(
  fsrs7Retrievability(30, 30),
  0.929334073664381,
  "固定遺忘曲線向量"
);

const referenceReviewAt = new Date("2026-07-25T00:00:00.000Z");
const referenceCard = {
  algorithm_version: FSRS_ALGORITHM_VERSION,
  last_rating: "good",
  due: referenceReviewAt.toISOString(),
  stability: 30,
  difficulty: 4.2,
  elapsed_days: 30,
  scheduled_days: 30,
  learning_steps: 0,
  reps: 8,
  lapses: 0,
  state: 2,
  last_review: "2026-06-25T00:00:00.000Z"
};
const referenceUpdates = {
  again: [4.279120565850242, 8.348491285716673],
  hard: [46.81680775603128, 6.267335285716673],
  good: [55.383860763820806, 4.186179285716674],
  easy: [59.19143987839392, 2.105023285716674]
};
for (const [rating, [expectedStability, expectedDifficulty]] of
  Object.entries(referenceUpdates)) {
  const updated = scheduleReview(referenceCard, rating, referenceReviewAt);
  assertClose(
    updated.stability,
    expectedStability,
    `固定 ${rating} stability 向量`,
    1e-10
  );
  assertClose(
    updated.difficulty,
    expectedDifficulty,
    `固定 ${rating} difficulty 向量`,
    1e-12
  );
}

const goodCard = firstCards.good;
const oneMillisecondBeforeDue = new Date(
  new Date(goodCard.due).getTime() - 1
);
assert.equal(
  isDue(goodCard, oneMillisecondBeforeDue),
  false,
  "尚未到 due 時間不可進入到期佇列"
);
assert.equal(
  isDue(goodCard, new Date(goodCard.due)),
  true,
  "到達 due 時間後必須進入到期佇列"
);

let growingCard = goodCard;
const intervals = [];
for (let review = 0; review < 4; review += 1) {
  const reviewAt = new Date(growingCard.due);
  growingCard = scheduleReview(growingCard, "good", reviewAt);
  intervals.push(growingCard.scheduled_days);
}
// 舊行為（10/30 分鐘學習步）會讓第二次複習仍在同一天；改為隔天畢業
// 後，後續每次乾淨回想的間隔都應是「天」等級並逐步拉開。
assert.ok(
  intervals[0] >= 1,
  "畢業後的下一次複習至少隔天，不可再當天跳針"
);
assert.ok(
  intervals.every((days) => days <= 366),
  "連續四次乾淨回想的間隔仍應停留在一年以內的合理範圍"
);
assert.ok(
  intervals.every(
    (days, index) => index === 0 || days > intervals[index - 1]
  ),
  `連續答 Good 後間隔應逐步增加，實際為 ${intervals.join(", ")}`
);

const reviewStart = new Date(growingCard.last_review);
const reviewDue = new Date(growingCard.due);
const afterDue = new Date(reviewDue.getTime() + 7 * 24 * 60 * 60 * 1000);
const freshMemory = retrievability(growingCard, reviewStart);
const dueMemory = retrievability(growingCard, reviewDue);
const overdueMemory = retrievability(growingCard, afterDue);
assert.ok(
  freshMemory > dueMemory && dueMemory > overdueMemory,
  "記憶率必須隨時間下降，才能依遺忘曲線判斷何時複習"
);

const lapseAt = new Date(growingCard.due);
const lapseCard = scheduleReview(growingCard, "again", lapseAt);
assert.equal(
  lapseCard.lapses,
  growingCard.lapses + 1,
  "答 Again 必須記錄一次遺忘"
);
// 重學步改為 1440 分鐘：忘記後隔天重寫即可，不必 10 分鐘內重打同一題。
assert.ok(
  new Date(lapseCard.due).getTime() - lapseAt.getTime() <=
    1440 * 60 * 1000,
  "答 Again 後必須在一天內重新出現"
);
assert.ok(
  lapseCard.stability < growingCard.stability,
  "答 Again 後記憶穩定度必須下降"
);
assert.ok(
  lapseCard.stability < growingCard.stability * 0.4,
  "答 Again 必須採官方失敗公式，不可再套用舊穩定度 40% 地板"
);
assert.ok(
  lapseCard.difficulty > growingCard.difficulty + 1.5,
  "答 Again 必須採官方 difficulty 更新，不可再套用 +1.5 增幅上限"
);
assert.equal(lapseCard.state, 3, "遺忘後必須進入 Relearning");

// 版本不符的舊卡改為「沿用記憶狀態、只更新版本欄」：舊版排程是真實
// 練習歷史，若一律視為到期／記憶率 0，升版當天所有題目會同時湧入。
const legacyCard = {
  ...growingCard,
  algorithm_version: undefined
};
assert.equal(
  isDue(legacyCard, start),
  isDue(growingCard, start),
  "版本不符的舊卡必須沿用原 due，不可一律視為立即到期"
);
assert.equal(
  retrievability(legacyCard, start),
  retrievability(growingCard, start),
  "版本不符的舊卡必須沿用其穩定度估記憶率，不可一律回 0"
);
assert.ok(
  retrievability(legacyCard, new Date(legacyCard.last_review)) > 0.9,
  "剛複習過的舊版卡片記憶率必須接近 1"
);
assert.equal(familiarityLabel(legacyCard, start), "待觀測");
const adoptedCard = scheduleReview(
  legacyCard,
  "good",
  new Date(legacyCard.due)
);
assert.equal(
  adoptedCard.reps,
  growingCard.reps + 1,
  "舊卡的複習次數必須沿用累計，不可歸零重數"
);
assert.equal(
  adoptedCard.lapses,
  growingCard.lapses,
  "舊卡的遺忘次數必須完整保留"
);
assert.ok(
  adoptedCard.stability > growingCard.stability,
  "沿用舊穩定度續排後，乾淨回想應讓穩定度繼續成長而非從新卡重跑"
);
assert.equal(
  adoptedCard.algorithm_version,
  FSRS_ALGORITHM_VERSION,
  "重排後必須寫入新版本欄"
);

const overdueCard = scheduleReview(
  undefined,
  "good",
  new Date("2026-07-01T00:00:00.000Z")
);
const futureCard = scheduleReview(undefined, "easy", start);
const sampleProblems = [
  { id: "new", order: 1 },
  { id: "future", order: 2 },
  { id: "overdue", order: 3 }
];
const sampleRecords = {
  future: { fsrs: futureCard },
  overdue: { fsrs: overdueCard }
};
const ordered = orderProblemsForReview(
  sampleProblems,
  sampleRecords,
  start
);
assert.deepEqual(
  ordered.map((problem) => problem.id),
  ["overdue", "new", "future"],
  "已到期的舊卡應先於新題，尚未到期的卡必須排到後面"
);

const chapterGroupedProblems = [
  { id: "dp-1", order: 1, category: "DP" },
  { id: "dp-2", order: 2, category: "DP" },
  { id: "tree-1", order: 3, category: "Tree" },
  { id: "tree-2", order: 4, category: "Tree" },
  { id: "graph-1", order: 5, category: "Graph" }
];
assert.deepEqual(
  interleaveProblemCategories(chapterGroupedProblems).map(
    (problem) => problem.id
  ),
  ["dp-1", "tree-1", "graph-1", "dp-2", "tree-2"],
  "短回合不可直接從章節排序 slice，否則整組會被同一題型塞滿"
);

const categoryBalancedProblems = [
  { id: "due-dp", order: 1, category: "DP" },
  { id: "new-dp", order: 2, category: "DP" },
  { id: "new-tree", order: 3, category: "Tree" },
  { id: "new-graph", order: 4, category: "Graph" },
  { id: "future-list", order: 5, category: "Linked List" }
];
assert.deepEqual(
  diversifiedSessionProblems(
    categoryBalancedProblems,
    {
      "due-dp": { fsrs: overdueCard },
      "future-list": { fsrs: futureCard }
    },
    start
  ).map((problem) => problem.id),
  ["due-dp", "new-tree", "new-graph", "new-dp", "future-list"],
  "自由回合應先保留可練題，再於題型之間輪流抽；未到期卡仍在最後"
);

assert.deepEqual(
  reviewSessionProblems(
    sampleProblems,
    sampleRecords,
    false,
    start
  ).map((problem) => problem.id),
  ["overdue", "new"],
  "複習模式只能收進已到期卡與新題，尚未到期卡不可因重新開一輪而提前出現"
);
assert.deepEqual(
  reviewSessionProblems(
    sampleProblems,
    sampleRecords,
    true,
    start,
    () => 0
  ).map((problem) => problem.id),
  ["overdue", "new"],
  "複習隨機只能打亂同一優先層；已到期卡仍須排在新題前，未到期卡仍不可出現"
);

const diverseProblems = [
  { id: "review-a", order: 1 },
  { id: "review-b", order: 2 },
  { id: "review-c", order: 3 },
  { id: "review-d", order: 4 },
  { id: "new-a", order: 5 },
  { id: "new-b", order: 6 },
  { id: "future", order: 7 }
];
const diverseRecords = {
  "review-a": { fsrs: overdueCard },
  "review-b": { fsrs: overdueCard },
  "review-c": { fsrs: overdueCard },
  "review-d": { fsrs: overdueCard },
  future: { fsrs: futureCard }
};
assert.deepEqual(
  diversifiedGuidedSessionProblems(
    diverseProblems,
    diverseRecords,
    start,
    () => 0.999
  ).map((problem) => problem.id),
  [
    "review-a",
    "review-b",
    "new-a",
    "review-c",
    "review-d",
    "new-b"
  ],
  "引導模式應以兩張到期複習卡搭配一張新題，且不可提前抽尚未到期卡"
);
assert.deepEqual(
  diversifiedGuidedSessionProblems(
    diverseProblems,
    diverseRecords,
    start,
    () => 0
  ).map((problem) => problem.id),
  [
    "review-b",
    "review-c",
    "new-b",
    "review-d",
    "review-a",
    "new-a"
  ],
  "同一批到期卡與新題應能在新回合改變順序，避免永遠固定從同幾題開始"
);

assert.deepEqual(
  reviewSessionProblems(
    [{ id: "repeat-checkpoint", order: 1 }],
    {
      "repeat-checkpoint": {
        fsrs: futureCard,
        recallCheckpointDue: "2026-07-24T23:30:00.000Z"
      }
    },
    false,
    start
  ).map((problem) => problem.id),
  ["repeat-checkpoint"],
  "Repeat 的延遲 0% 驗收即使原 FSRS 尚未到期，也必須在 checkpoint 到期後出現"
);
assert.deepEqual(
  reviewSessionProblems(
    [{ id: "cooling-down", order: 1 }],
    {
      "cooling-down": {
        recallCheckpointDue: "2026-07-25T00:30:00.000Z"
      }
    },
    false,
    start
  ),
  [],
  "Repeat 冷卻中的新題不可被「尚無 FSRS」規則立刻重新抽出"
);

const restoredQueue = mergeDueReviewsIntoQueue(
  sampleProblems,
  sampleRecords,
  ["new", "future"],
  20,
  start
);
assert.deepEqual(
  restoredQueue,
  ["overdue", "new", "future"],
  "重新開站時，遺忘曲線判定到期的舊題必須自動插回佇列最前面"
);

const dueAfterCurrent = insertDueReviewsAfterCurrent(
  sampleProblems,
  sampleRecords,
  ["new", "future"],
  20,
  start
);
assert.deepEqual(
  dueAfterCurrent,
  ["new", "overdue", "future"],
  "練習途中剛到期的題目應排在目前題目後面，不可突然換掉正在作答的題目"
);

assert.deepEqual(
  advancePracticeQueue(["accepted", "next", "last"], false),
  ["next", "last"],
  "AC 後必須把目前題目從本輪移除，直接進下一題"
);
assert.deepEqual(
  advancePracticeQueue(["retry", "next", "last"], true),
  ["next", "last", "retry"],
  "跳過的題目應移到本輪最後，先走完其餘題目再回來"
);
const queueAfterSkipping = advancePracticeQueue(
  ["skipped", "next", "last"],
  true
);
const restoredAfterSkipping = restorePreviousPracticeProblem(
  queueAfterSkipping,
  rememberPracticeProblem([], "skipped")
);
assert.deepEqual(
  restoredAfterSkipping,
  {
    queue: ["skipped", "next", "last"],
    history: []
  },
  "篩選題單中跳過後按 F8，必須回到剛跳過的題目，不能改用整個題庫的相鄰題"
);

const rememberedAfterAccepted = rememberPracticeProblem(
  [],
  "accepted"
);
assert.deepEqual(rememberedAfterAccepted, ["accepted"]);
const restoredAfterAccepted = restorePreviousPracticeProblem(
  ["next", "last"],
  rememberedAfterAccepted
);
assert.deepEqual(
  restoredAfterAccepted,
  {
    queue: ["accepted", "next", "last"],
    history: []
  },
  "AC 移除目前題目後，上一題必須能從實際瀏覽歷史插回 queue 最前面"
);
assert.deepEqual(
  advancePracticeQueue(restoredAfterAccepted.queue, false),
  ["next", "last"],
  "返回上一題後再前進，必須回到原本尚未處理的下一題"
);
assert.deepEqual(
  rememberPracticeProblem(["accepted"], "accepted"),
  ["accepted"],
  "同一題不可連續寫入兩次返回歷史"
);
assert.deepEqual(
  restorePreviousPracticeProblem([], ["accepted"]),
  {
    queue: ["accepted"],
    history: []
  },
  "AC 本輪最後一題後，即使 queue 已空，F8 仍必須能返回剛完成的題目"
);
const restoredSecondPrevious = restorePreviousPracticeProblem(
  ["third", "fourth"],
  ["first", "second"]
);
assert.deepEqual(
  restoredSecondPrevious,
  {
    queue: ["second", "third", "fourth"],
    history: ["first"]
  },
  "連續前進多題後，第一次 F8 必須回到真正的上一題"
);
assert.deepEqual(
  restorePreviousPracticeProblem(
    restoredSecondPrevious.queue,
    restoredSecondPrevious.history
  ),
  {
    queue: ["first", "second", "third", "fourth"],
    history: []
  },
  "連按 F8 必須依照實際瀏覽順序逐題返回"
);

const submission = (problemId, passed) => ({
  id: `${problemId}-${passed}`,
  problemId,
  submittedAt: start.toISOString(),
  passed,
  durationMs: 1000
});
// easy 放寬後：無失敗、無提示且用時遠低於基準的乾淨 AC 直接視為熟練。
assert.equal(
  ratingForAcceptedSubmission([], "target"),
  "easy",
  "乾淨且快速的第一次 AC 應評為 Easy，讓間隔正常拉開"
);
assert.equal(
  ratingForAcceptedSubmission(
    [submission("other", false), submission("target", false)],
    "target"
  ),
  "hard",
  "錯一次後才 AC 應評為 Hard"
);
// again 門檻 5 → 8：兩次失敗（6 分）不再直接歸零，降為 Hard。
assert.equal(
  ratingForAcceptedSubmission(
    [
      submission("target", false),
      submission("other", true),
      submission("target", false),
      submission("target", true),
      submission("target", false)
    ],
    "target"
  ),
  "hard",
  "只統計上次 AC 後的本題錯誤；錯兩次應評為 Hard 而非直接歸零"
);
assert.equal(
  ratingForAcceptedSubmission(
    [
      submission("target", false),
      submission("target", false),
      submission("target", false),
      submission("target", true)
    ],
    "target"
  ),
  "again",
  "連錯三次以上（分數 9 ≥ 8）且含真正執行失敗，才評為 Again"
);

const cleanAssessment = assessAcceptedSubmission([], "target", {
  durationMs: 8 * 60 * 1000,
  difficulty: "medium"
});
// 8 分鐘寫完 medium（基準 20 分鐘）且零失敗零提示：easy 放寬後即為熟練。
assert.equal(cleanAssessment.rating, "easy");
assert.equal(cleanAssessment.struggleScore, 0);

const slowCleanAssessment = assessAcceptedSubmission([], "target", {
  durationMs: 19 * 60 * 1000,
  difficulty: "medium"
});
assert.equal(
  slowCleanAssessment.rating,
  "good",
  "乾淨但用時接近基準（>90%）的 AC 仍是 Good，不可自動升級 Easy"
);

const hintedAssessment = assessAcceptedSubmission([], "target", {
  durationMs: 8 * 60 * 1000,
  difficulty: "medium",
  hintsUsed: 2
});
// 純提示沒有真正執行失敗：最多降到 Hard，不再把整段記憶判定歸零。
assert.equal(
  hintedAssessment.rating,
  "hard",
  "只靠提示完成必須降級為 Hard，但不可直接視為完全遺忘"
);

const resetAssessment = assessAcceptedSubmission([], "target", {
  durationMs: 8 * 60 * 1000,
  difficulty: "medium",
  resetCount: 1
});
assert.equal(
  resetAssessment.rating,
  "hard",
  "重設骨架後才 AC 不可當成一次乾淨回想"
);

const answerAssessment = assessAcceptedSubmission([], "target", {
  durationMs: 8 * 60 * 1000,
  difficulty: "medium",
  answerRevealCount: 1
});
assert.equal(
  answerAssessment.rating,
  "hard",
  "開啟答案後才 AC 必須降低本次記憶評級"
);

const slowAssessment = assessAcceptedSubmission([], "target", {
  durationMs: 30 * 60 * 1000,
  difficulty: "medium"
});
// 時間壓力權重減半：寫得慢只是提取速度慢，單靠超時不可降到 Hard。
assert.equal(
  slowAssessment.rating,
  "good",
  "沒有失敗與提示時，單靠寫得慢不能把乾淨回想降成 Hard"
);
assert.ok(
  slowAssessment.struggleScore < 1,
  "單獨的時間壓力必須永遠低於 Hard 門檻（1）"
);

const rewriteAssessment = assessAcceptedSubmission([], "target", {
  durationMs: 8 * 60 * 1000,
  difficulty: "medium",
  insertedChars: 1000,
  deletedChars: 600
});
assert.equal(
  rewriteAssessment.rating,
  "hard",
  "大量刪除重寫必須被視為不穩，而非只看最後 AC"
);

// easy 放寬：不再要求兩次歷史 AC，比自己的乾淨最佳時間快即可。
const easyAssessment = assessAcceptedSubmission([], "target", {
  durationMs: 8 * 60 * 1000,
  difficulty: "medium",
  previousBestMs: 10 * 60 * 1000
});
assert.equal(
  easyAssessment.rating,
  "easy",
  "無失敗、無提示且快於個人基準九成，即可自動評為 Easy"
);

const studyRecord = (status, passed = 0) => ({
  status,
  attempts: 0,
  passed,
  memoryPassed: passed,
  assistedPassed: 0,
  failed: 0,
  hints: 0,
  streak: 0,
  totalMs: 0
});
assert.equal(
  problemLibraryRank({
    ...studyRecord("learning", 0),
    passed: 3,
    assistedPassed: 3
  }),
  1,
  "只靠看答案或 Repeat 通過不可列入已解決"
);
assert.equal(
  statusAfterLeavingEditedProblem(studyRecord("new")),
  "learning",
  "未送出但確實輸入後離題，必須標成嘗試中"
);
for (const status of ["retry", "completed", "mastered"]) {
  assert.equal(
    statusAfterLeavingEditedProblem(studyRecord(status)),
    status,
    `離題不可覆蓋既有的 ${status} 狀態`
  );
}
assert.equal(
  statusAfterResettingProblem(studyRecord("learning")),
  "new",
  "重設骨架必須清除嘗試中狀態"
);
for (const status of ["new", "retry", "completed", "mastered"]) {
  assert.equal(
    statusAfterResettingProblem(studyRecord(status)),
    status,
    `重設骨架不可改動 ${status} 狀態`
  );
}
assert.deepEqual(
  [
    studyRecord("new"),
    studyRecord("learning"),
    studyRecord("completed", 1)
  ]
    .sort((left, right) => problemLibraryRank(left) - problemLibraryRank(right))
    .map((record) => record.status),
  ["completed", "learning", "new"],
  "總題庫必須依序顯示已解過、嘗試中、尚未解決"
);

assert.deepEqual(
  explorationPool(
    [
      { id: "passed-before" },
      { id: "completed" },
      { id: "failed-only" },
      { id: "new" }
    ],
    {
      "passed-before": studyRecord("retry", 1),
      completed: studyRecord("completed", 0),
      "failed-only": studyRecord("retry", 0),
      new: studyRecord("new", 0)
    }
  ).map((problem) => problem.id),
  ["passed-before"],
  "探險模式只能抽至少有一次獨立 AC 的題目；狀態標籤本身不能冒充記憶證據"
);

assert.equal(matchesDifficultyFilter("easy", "medium"), false);
assert.equal(matchesDifficultyFilter("medium", "medium"), true);
assert.equal(matchesDifficultyFilter("hard", "medium"), false);
assert.equal(matchesDifficultyFilter("easy", "easy-medium"), true);
assert.equal(matchesDifficultyFilter("medium", "easy-medium"), true);
assert.equal(matchesDifficultyFilter("hard", "easy-medium"), false);
assert.equal(matchesDifficultyFilter("easy", "medium-hard"), false);
assert.equal(matchesDifficultyFilter("medium", "medium-hard"), true);
assert.equal(matchesDifficultyFilter("hard", "medium-hard"), true);
assert.equal(matchesDifficultyFilter("unknown", "known"), false);
assert.equal(matchesDifficultyFilter("hard", "known"), true);
assert.equal(matchesDifficultyFilter("unknown", "unknown"), true);
assert.equal(matchesDifficultyFilter("unknown", "all"), true);
const searchableProblem = {
  identity: "LeetCode 215",
  title: "陣列中的第 K 大元素",
  category: "Heap",
  sources: ["Core 75", "Extended 150"]
};
assert.equal(
  matchesProblemLibraryQuery(searchableProblem, "215"),
  true
);
assert.equal(
  matchesProblemLibraryQuery(searchableProblem, "heap"),
  true
);
assert.equal(
  matchesProblemLibraryQuery(searchableProblem, "extended"),
  true
);
assert.equal(
  matchesProblemLibraryQuery(searchableProblem, "binary tree"),
  false
);

const beforeSkip = {
  ...studyRecord("completed", 2),
  attempts: 5,
  failed: 3,
  streak: 2,
  fsrs: futureCard
};
const afterSkip = recordAfterSkipping(
  beforeSkip,
  new Date("2026-07-25T12:00:00.000Z")
);
assert.deepEqual(
  afterSkip,
  beforeSkip,
  "未編輯就跳過只改導覽 queue，不可把未到期舊題強制改成 retry"
);
assert.equal(
  afterSkip.streak,
  beforeSkip.streak,
  "跳過不是錯誤提交，不可清掉既有連續成功"
);
assert.equal(afterSkip.attempts, 5);
assert.equal(afterSkip.failed, 3);
assert.deepEqual(
  afterSkip.fsrs,
  beforeSkip.fsrs,
  "跳過不可改寫 FSRS 卡片"
);
const untouchedNewRecord = studyRecord("new", 0);
const untouchedNewAfterSkip = recordAfterSkipping(
  untouchedNewRecord,
  new Date("2026-07-25T12:00:00.000Z"),
  false
);
assert.deepEqual(
  untouchedNewAfterSkip,
  untouchedNewRecord,
  "全新題完全沒輸入就跳過，只改本輪 queue，不可把題目誤判成錯題"
);
const editedNewAfterSkip = recordAfterSkipping(
  untouchedNewRecord,
  new Date("2026-07-25T12:00:00.000Z"),
  true
);
assert.equal(
  editedNewAfterSkip.status,
  "learning",
  "全新題有輸入但未提交就跳過，只能標成嘗試中"
);
assert.equal(editedNewAfterSkip.attempts, 0);
assert.equal(editedNewAfterSkip.failed, 0);
assert.deepEqual(
  advancePracticeQueue(["a", "b", "c"], true),
  ["b", "c", "a"]
);
const immutableQueue = ["a", "b", "c"];
advancePracticeQueue(immutableQueue, true);
assert.deepEqual(
  immutableQueue,
  ["a", "b", "c"],
  "上一題、下一題與跳過只能產生新 queue，不可原地污染目前 session"
);

console.log(
  `FSRS-7 行為測試通過：隔天學習步、自動評分、到期插隊、間隔成長、記憶衰退與舊卡沿用。間隔 ${intervals.join(
    " → "
  )} 天。`
);
