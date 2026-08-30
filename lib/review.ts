import { isDue } from "./fsrs.ts";
import {
  buildRecallCalibration,
  recallCalibrationPressure
} from "./memoryCalibration.ts";
import { isMemoryEligibleSubmission } from "./memoryEvidence.ts";
import { isRepeatCheckpointDue } from "./repeatMode.ts";
import type {
  Difficulty,
  FsrsRating,
  PracticeMode,
  ProblemSummary,
  StudyRecord,
  StudyStatus,
  SubmissionEvent
} from "./types.ts";

export type DifficultyFilter =
  | "all"
  | Difficulty
  | "easy-medium"
  | "medium-hard"
  | "known";

export interface ReviewEvidence {
  durationMs: number;
  difficulty: Difficulty;
  previousBestMs?: number;
  previousPasses?: number;
  /** 上一次已寫入 FSRS 的時間；更舊的錯誤已結算，不可跨回合重算。 */
  previousReviewAt?: string;
  hintsUsed?: number;
  insertedChars?: number;
  deletedChars?: number;
  editOperations?: number;
  resetCount?: number;
  answerRevealCount?: number;
}

export interface ReviewAssessment {
  rating: FsrsRating;
  failures: number;
  roundDurationMs: number;
  hintsUsed: number;
  resetCount: number;
  answerRevealCount: number;
  insertedChars: number;
  deletedChars: number;
  editOperations: number;
  struggleScore: number;
  timeRatio: number;
  rewriteRatio: number;
  calibrationPressure: number;
  calibrationSampleSize: number;
  calibrationBias: number;
}

export interface PracticeModeSwitchPolicy {
  preserveCurrentProblem: boolean;
  memoryEvidence: "none";
}

export interface PracticeModeQueuePolicy {
  /** 是否允許尚未到 FSRS due 的舊題進入本輪。 */
  allowEarly: boolean;
  /** 沒有 FSRS 的新題仍屬於可開始的題目，不受此旗標影響。 */
  includeNew: true;
}

export interface SessionProblemOptions {
  now?: Date;
  randomize?: boolean;
  random?: () => number;
  /** 只有 Free 會採用；其他模式一律不可提前複習。 */
  allowEarly?: boolean;
  /** 由舊到新排列；越靠近尾端代表越近期看過。 */
  recentProblemIds?: string[];
}

/**
 * 引導、自由與探險只是在改「後續題目怎麼排」，可以延續目前作答。
 * Speed、Repeat 與模擬面試有獨立計時／提示規則，必須另開回合。
 * 無論切去哪個模式，切換動作本身永遠不是記憶證據。
 */
export function practiceModeSwitchPolicy(
  currentMode: PracticeMode,
  nextMode: PracticeMode
): PracticeModeSwitchPolicy {
  const continuousModes = new Set<PracticeMode>([
    "guided",
    "free",
    "explore"
  ]);
  return {
    preserveCurrentProblem:
      currentMode !== nextMode &&
      continuousModes.has(currentMode) &&
      continuousModes.has(nextMode),
    memoryEvidence: "none"
  };
}

/**
 * 模式的排程邊界集中在這裡，避免每個 UI 入口各自猜一次。
 * Free 必須明確傳入 allowEarly=true 才能主動提前練習；Guided、Speed、
 * Repeat 與 Interview 永遠只收現在可練的卡，隨機只改順序不改資格。
 */
export function practiceModeQueuePolicy(
  mode: PracticeMode,
  allowEarly = false
): PracticeModeQueuePolicy {
  return {
    allowEarly:
      mode === "explore" || (mode === "free" && allowEarly === true),
    includeNew: true
  };
}

/**
 * 清除存檔殘留的無效 id 與重複題；保留第一個出現位置，絕不原地修改。
 */
export function normalizePracticeQueue(
  queue: readonly string[],
  validProblemIds?: Iterable<string>
): string[] {
  const valid = validProblemIds
    ? new Set(validProblemIds)
    : undefined;
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawId of queue) {
    const problemId = typeof rawId === "string" ? rawId.trim() : "";
    if (
      !problemId ||
      seen.has(problemId) ||
      (valid && !valid.has(problemId))
    ) {
      continue;
    }
    seen.add(problemId);
    normalized.push(problemId);
  }
  return normalized;
}

/**
 * 保留目前題目在第一格，只依新模式重排後面的待刷題。
 * sessionSize 包含目前題目；0 代表不限制數量。
 */
export function queueAfterPreservedModeSwitch(
  currentProblemId: string,
  orderedProblemIds: string[],
  sessionSize: number,
  validProblemIds?: Iterable<string>
): string[] {
  const queue = normalizePracticeQueue(
    [currentProblemId, ...orderedProblemIds],
    validProblemIds
  );

  if (sessionSize === 0) return queue;
  return queue.slice(0, Math.max(queue.length > 0 ? 1 : 0, sessionSize));
}

export function matchesDifficultyFilter(
  difficulty: Difficulty,
  filter: DifficultyFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "easy-medium") {
    return difficulty === "easy" || difficulty === "medium";
  }
  if (filter === "medium-hard") {
    return difficulty === "medium" || difficulty === "hard";
  }
  if (filter === "known") return difficulty !== "unknown";
  return difficulty === filter;
}

export function matchesProblemLibraryQuery(
  problem: Pick<
    ProblemSummary,
    "identity" | "title" | "category" | "sources"
  >,
  query: string
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    problem.identity,
    problem.title,
    problem.category,
    ...problem.sources
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function dueTime(record: StudyRecord | undefined): number {
  if (!record) return Number.POSITIVE_INFINITY;
  const times = [
    record.fsrs?.due,
    record.recallCheckpointDue
  ]
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);
  return times.length
    ? Math.min(...times)
    : Number.POSITIVE_INFINITY;
}

export function advancePracticeQueue(
  queue: string[],
  retry: boolean
): string[] {
  const normalized = normalizePracticeQueue(queue);
  if (!normalized.length) return normalized;
  const [current, ...rest] = normalized;
  if (!retry) return rest;
  return [...rest, current];
}

export function rememberPracticeProblem(
  history: string[],
  problemId: string,
  limit = 100
): string[] {
  if (!problemId || history.at(-1) === problemId) return history;
  return [...history, problemId].slice(-limit);
}

export function restorePreviousPracticeProblem(
  queue: string[],
  history: string[]
): { queue: string[]; history: string[] } | null {
  const previousId = history.at(-1);
  if (!previousId) return null;

  return {
    queue: [previousId, ...queue.filter((id) => id !== previousId)],
    history: history.slice(0, -1)
  };
}

export function ratingForAcceptedSubmission(
  history: SubmissionEvent[],
  problemId: string,
  evidence: ReviewEvidence = {
    durationMs: 0,
    difficulty: "unknown"
  }
): FsrsRating {
  return assessAcceptedSubmission(history, problemId, evidence).rating;
}

function eventNumber(
  event: SubmissionEvent,
  key:
    | "hintsUsed"
    | "insertedChars"
    | "deletedChars"
    | "editOperations"
    | "resetCount"
    | "answerRevealCount"
): number {
  return Math.max(0, Number(event[key]) || 0);
}

export function assessAcceptedSubmission(
  history: SubmissionEvent[],
  problemId: string,
  evidence: ReviewEvidence
): ReviewAssessment {
  const recentFailures: SubmissionEvent[] = [];
  const previousReviewAt = evidence.previousReviewAt
    ? Date.parse(evidence.previousReviewAt)
    : Number.NaN;

  for (const submission of history) {
    if (
      submission.problemId !== problemId ||
      !isMemoryEligibleSubmission(submission)
    ) {
      continue;
    }
    if (
      Number.isFinite(previousReviewAt) &&
      Date.parse(submission.submittedAt) <= previousReviewAt
    ) {
      break;
    }
    if (submission.passed) break;
    recentFailures.push(submission);
  }

  const sumEvents = (
    key:
      | "hintsUsed"
      | "insertedChars"
      | "deletedChars"
      | "editOperations"
      | "resetCount"
      | "answerRevealCount"
  ) =>
    recentFailures.reduce(
      (total, event) => total + eventNumber(event, key),
      0
    );
  const failures = recentFailures.length;
  const roundDurationMs =
    Math.max(0, evidence.durationMs) +
    recentFailures.reduce(
      (total, event) => total + Math.max(0, event.durationMs),
      0
    );
  const hintsUsed =
    Math.max(0, evidence.hintsUsed ?? 0) + sumEvents("hintsUsed");
  const resetCount =
    Math.max(0, evidence.resetCount ?? 0) + sumEvents("resetCount");
  const answerRevealCount =
    Math.max(0, evidence.answerRevealCount ?? 0) +
    sumEvents("answerRevealCount");
  const insertedChars =
    Math.max(0, evidence.insertedChars ?? 0) +
    sumEvents("insertedChars");
  const deletedChars =
    Math.max(0, evidence.deletedChars ?? 0) +
    sumEvents("deletedChars");
  const editOperations =
    Math.max(0, evidence.editOperations ?? 0) +
    sumEvents("editOperations");
  const firstPassLimit = {
    easy: 12 * 60 * 1000,
    medium: 20 * 60 * 1000,
    hard: 35 * 60 * 1000,
    unknown: 20 * 60 * 1000
  }[evidence.difficulty];
  const timeBaseline = Math.max(
    30_000,
    evidence.previousBestMs ?? firstPassLimit
  );
  const timeRatio = roundDurationMs / timeBaseline;
  const rewriteRatio =
    deletedChars / Math.max(120, insertedChars);
  // 寫得慢代表提取速度、不等於遺忘：時間壓力權重減半（斜率 /0.5 → /1）
  // 且上限 0.9，單靠超時永遠碰不到 hard 門檻（1）。
  const timePressure = clampNumber(
    (timeRatio - 1) / 1,
    0,
    0.9
  );
  const rewritePressure = clampNumber(
    (rewriteRatio - 0.25) / 0.35,
    0,
    2
  );
  const calibration = buildRecallCalibration(history);
  const calibrationPressure =
    recallCalibrationPressure(calibration);

  // The score describes how much assistance or reconstruction this recall
  // required. Errors and explicit help dominate; ordinary editing contributes
  // only after deletions become a substantial part of the written solution.
  const struggleScore =
    Math.min(failures, 3) * 3 +
    Math.min(hintsUsed, 3) * 2.5 +
    Math.min(resetCount, 3) * 2.5 +
    Math.min(answerRevealCount, 3) +
    timePressure +
    rewritePressure +
    calibrationPressure;

  let rating: FsrsRating;
  // again 門檻 5 → 8，且必須含至少一次真正執行失敗：一次失敗（3）+
  // 一個提示（2.5）= 5.5 不再直接歸零；純提示／純超時最多降到 hard。
  if (struggleScore >= 8 && failures > 0) {
    rating = "again";
  } else if (struggleScore >= 1) {
    rating = "hard";
  } else if (
    // easy 放寬：拿掉「至少兩次歷史 AC」硬條件；無失敗、無提示且用時
    // 不超過基準的 90% 就是熟練，讓穩定的題目間隔可以正常拉開。
    failures === 0 &&
    hintsUsed === 0 &&
    timeRatio <= 0.9
  ) {
    rating = "easy";
  } else {
    rating = "good";
  }

  return {
    rating,
    failures,
    roundDurationMs,
    hintsUsed,
    resetCount,
    answerRevealCount,
    insertedChars,
    deletedChars,
    editOperations,
    struggleScore,
    timeRatio,
    rewriteRatio,
    calibrationPressure,
    calibrationSampleSize: calibration.sampleSize,
    calibrationBias: calibration.bias
  };
}

function clampNumber(
  value: number,
  minimum: number,
  maximum: number
): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function statusAfterLeavingEditedProblem(
  record: StudyRecord
): StudyStatus {
  if (record.status !== "new") return record.status;
  return "learning";
}

export function statusAfterResettingProblem(
  record: StudyRecord
): StudyStatus {
  if (record.status !== "learning") return record.status;
  return "new";
}

export function recordAfterSkipping(
  record: StudyRecord,
  skippedAt = new Date(),
  edited = false
): StudyRecord {
  // 純導覽不等於遺忘。尤其是 Free 的未到期舊題，若「看一眼就跳過」
  // 便改成 retry，會繞過 due 並污染下一輪選題。
  if (!edited) return record;
  const neverAttempted =
    record.attempts === 0 &&
    record.passed === 0 &&
    record.failed === 0 &&
    !record.fsrs &&
    !record.recallCheckpointDue;

  if (neverAttempted) {
    return {
      ...record,
      status: "learning",
      lastStudiedAt: skippedAt.toISOString()
    };
  }

  return {
    ...record,
    status: "retry",
    lastStudiedAt: skippedAt.toISOString()
  };
}

export function problemLibraryRank(
  record: StudyRecord | undefined
): number {
  if (independentPassCount(record) > 0) {
    return 0;
  }
  if (record?.status === "learning") return 1;
  return 2;
}

export function independentPassCount(
  record: StudyRecord | undefined
): number {
  if (!record) return 0;
  if (typeof record.memoryPassed === "number") {
    return Math.max(0, record.memoryPassed);
  }
  // 僅供尚未跑過 v5 遷移的舊物件與單元測試使用。新版資料一律會寫
  // memoryPassed；FSRS 卡片則至少代表曾有一次可排程的獨立回想。
  return record.fsrs ? 1 : 0;
}

export function explorationPool<
  Problem extends Pick<ProblemSummary, "id">
>(
  problems: Problem[],
  records: Record<string, StudyRecord>
): Problem[] {
  return problems.filter(
    (problem) => problemLibraryRank(records[problem.id]) === 0
  );
}

export function isProblemDue(
  problem: ProblemSummary,
  records: Record<string, StudyRecord>,
  now = new Date()
): boolean {
  return isRecordReadyForReview(records[problem.id], now);
}

export function isRecordReadyForReview(
  record: StudyRecord | undefined,
  now = new Date()
): boolean {
  // checkpoint 存在時，它是 Repeat 後的冷卻閘門；尚未到 30 分鐘不能
  // 因為「沒有 FSRS = 新題」而立刻又被抽到。
  if (record?.recallCheckpointDue) {
    return isRepeatCheckpointDue(record.recallCheckpointDue, now);
  }
  // retry 是尚未完成的回想，不可被上一次仍在未來的 FSRS due 藏起來。
  // Repeat checkpoint 仍優先作為冷卻閘門，避免跟打後立刻重抽。
  if (record?.status === "retry") return true;
  return isDue(record?.fsrs, now);
}

export function orderProblemsForReview(
  problems: ProblemSummary[],
  records: Record<string, StudyRecord>,
  now = new Date()
): ProblemSummary[] {
  return [...problems].sort((left, right) => {
    const leftRecord = records[left.id];
    const rightRecord = records[right.id];
    const leftDue = isRecordReadyForReview(leftRecord, now);
    const rightDue = isRecordReadyForReview(rightRecord, now);

    if (leftDue !== rightDue) return leftDue ? -1 : 1;

    const leftDueTime = dueTime(leftRecord);
    const rightDueTime = dueTime(rightRecord);
    const leftScheduled = Number.isFinite(leftDueTime);
    const rightScheduled = Number.isFinite(rightDueTime);
    if (leftScheduled !== rightScheduled) return leftScheduled ? -1 : 1;
    if (leftScheduled && leftDueTime !== rightDueTime) {
      return leftDueTime - rightDueTime;
    }
    return left.order - right.order;
  });
}

/**
 * 題庫索引依題型分章，所以直接 slice 會把同一章整批塞進短回合。
 * 這裡把每個題型視為一疊牌，每輪各拿一張；每疊內部仍保留原本的
 * FSRS／題目順序，只改不同題型之間的交錯方式。
 */
export function interleaveProblemCategories<
  Problem extends { category?: string }
>(problems: Problem[]): Problem[] {
  const categoryOrder: string[] = [];
  const buckets = new Map<string, Problem[]>();

  for (const problem of problems) {
    const category = problem.category?.trim() || "未分類";
    const bucket = buckets.get(category);
    if (bucket) {
      bucket.push(problem);
    } else {
      categoryOrder.push(category);
      buckets.set(category, [problem]);
    }
  }

  const result: Problem[] = [];
  let offset = 0;
  let added = true;
  while (added) {
    added = false;
    for (const category of categoryOrder) {
      const problem = buckets.get(category)?.[offset];
      if (!problem) continue;
      result.push(problem);
      added = true;
    }
    offset += 1;
  }
  return result;
}

function uniqueProblemCandidates<
  Problem extends Pick<ProblemSummary, "id">
>(problems: Problem[]): Problem[] {
  const seen = new Set<string>();
  return problems.filter((problem) => {
    if (!problem.id || seen.has(problem.id)) return false;
    seen.add(problem.id);
    return true;
  });
}

function hasReviewHistory(record: StudyRecord | undefined): boolean {
  return Boolean(
    record &&
      (record.fsrs ||
        record.recallCheckpointDue ||
        record.attempts > 0 ||
        record.status !== "new")
  );
}

/**
 * 最近做過的題目移到同一優先層後面；最新做過的排最末端。
 * 先分新舊再做題型交錯，避免「跳過一題」之後連續抽到同一分類。
 */
export function deprioritizeRecentlySeenProblems<
  Problem extends Pick<ProblemSummary, "id"> & { category?: string }
>(problems: Problem[], recentProblemIds: readonly string[]): Problem[] {
  if (!recentProblemIds.length) {
    return interleaveProblemCategories(uniqueProblemCandidates(problems));
  }
  const recentIndex = new Map<string, number>();
  recentProblemIds.forEach((id, index) => recentIndex.set(id, index));
  const fresh: Problem[] = [];
  const recent: Problem[] = [];
  for (const problem of uniqueProblemCandidates(problems)) {
    (recentIndex.has(problem.id) ? recent : fresh).push(problem);
  }
  recent.sort(
    (left, right) =>
      (recentIndex.get(left.id) ?? -1) -
      (recentIndex.get(right.id) ?? -1)
  );
  return [
    ...interleaveProblemCategories(fresh),
    ...interleaveProblemCategories(recent)
  ];
}

/**
 * 先切開「現在可練」與「未來卡」，再各自在題型之間輪流抽取。
 * 舊呼叫預設保留 Free 的提早練習行為；新程式應透過
 * sessionProblemsForMode 明確宣告 allowEarly，避免 Repeat／Interview 誤用。
 */
export function diversifiedSessionProblems(
  problems: ProblemSummary[],
  records: Record<string, StudyRecord>,
  now = new Date(),
  randomize = false,
  random: () => number = Math.random,
  allowEarly = true
): ProblemSummary[] {
  const ordered = orderProblemsForReview(
    uniqueProblemCandidates(problems),
    records,
    now
  );
  const ready: ProblemSummary[] = [];
  const future: ProblemSummary[] = [];

  for (const problem of ordered) {
    const record = records[problem.id];
    if (isRecordReadyForReview(record, now)) {
      ready.push(problem);
    } else if (!record?.recallCheckpointDue) {
      // checkpoint 是 Repeat 的硬冷卻閘門；Free 的 allowEarly 只能提前
      // 一般 FSRS 卡，不能繞過剛跟打完的延遲驗收。
      future.push(problem);
    }
  }

  const arrange = (items: ProblemSummary[]) =>
    interleaveProblemCategories(
      randomize ? shuffledCopy(items, random) : items
    );
  return [
    ...arrange(ready),
    ...(allowEarly ? arrange(future) : [])
  ];
}

function shuffledCopy<T>(
  items: T[],
  random: () => number
): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function reviewSessionProblems(
  problems: ProblemSummary[],
  records: Record<string, StudyRecord>,
  randomize = false,
  now = new Date(),
  random: () => number = Math.random
): ProblemSummary[] {
  const ready = orderProblemsForReview(
    uniqueProblemCandidates(problems),
    records,
    now
  ).filter(
    (problem) => isRecordReadyForReview(records[problem.id], now)
  );

  const scheduled: ProblemSummary[] = [];
  const newProblems: ProblemSummary[] = [];

  for (const problem of ready) {
    if (hasReviewHistory(records[problem.id])) {
      scheduled.push(problem);
    } else {
      newProblems.push(problem);
    }
  }

  // FSRS first decides which cards are ready. Random mode only changes the
  // order inside each priority layer, so overdue cards still precede new ones
  // and future cards never leak into the review queue.
  const arrange = (items: ProblemSummary[]) =>
    interleaveProblemCategories(
      randomize ? shuffledCopy(items, random) : items
    );
  return [...arrange(scheduled), ...arrange(newProblems)];
}

/**
 * 引導模式仍只使用「目前到期」與「尚未建立排程」的題目，
 * 但不把同一批最舊卡永遠鎖在最前面。
 *
 * 每兩張複習卡插入一張新題；兩個池子各自洗牌。這只調整本輪
 * 出題順序，不會改動 FSRS due、rating 或任何記憶紀錄。
 */
export function diversifiedGuidedSessionProblems(
  problems: ProblemSummary[],
  records: Record<string, StudyRecord>,
  now = new Date(),
  random: () => number = Math.random,
  reviewBurst = 2,
  recentProblemIds: readonly string[] = []
): ProblemSummary[] {
  const ready = orderProblemsForReview(
    uniqueProblemCandidates(problems),
    records,
    now
  ).filter(
    (problem) => isRecordReadyForReview(records[problem.id], now)
  );
  const reviews: ProblemSummary[] = [];
  const newProblems: ProblemSummary[] = [];

  for (const problem of ready) {
    const record = records[problem.id];
    if (hasReviewHistory(record)) {
      reviews.push(problem);
    } else {
      newProblems.push(problem);
    }
  }

  const shuffledReviews = deprioritizeRecentlySeenProblems(
    shuffledCopy(reviews, random),
    recentProblemIds
  );
  const shuffledNewProblems = deprioritizeRecentlySeenProblems(
    shuffledCopy(newProblems, random),
    recentProblemIds
  );
  const result: ProblemSummary[] = [];
  const safeReviewBurst = Math.max(1, Math.trunc(reviewBurst));
  let reviewIndex = 0;
  let newIndex = 0;

  while (
    reviewIndex < shuffledReviews.length ||
    newIndex < shuffledNewProblems.length
  ) {
    for (
      let count = 0;
      count < safeReviewBurst && reviewIndex < shuffledReviews.length;
      count += 1
    ) {
      result.push(shuffledReviews[reviewIndex]);
      reviewIndex += 1;
    }
    if (newIndex < shuffledNewProblems.length) {
      result.push(shuffledNewProblems[newIndex]);
      newIndex += 1;
    }
    if (reviewIndex >= shuffledReviews.length) {
      result.push(...shuffledNewProblems.slice(newIndex));
      break;
    }
  }

  return result;
}

/**
 * 單一模式入口：排程資格、題型交錯、最近題目降權都由純函式決定。
 * Free 若要包含未到期舊題，呼叫端必須明確傳 allowEarly: true。
 */
export function sessionProblemsForMode(
  mode: PracticeMode,
  problems: ProblemSummary[],
  records: Record<string, StudyRecord>,
  options: SessionProblemOptions = {}
): ProblemSummary[] {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const recentProblemIds = options.recentProblemIds ?? [];
  const policy = practiceModeQueuePolicy(mode, options.allowEarly);

  if (mode === "guided") {
    return diversifiedGuidedSessionProblems(
      problems,
      records,
      now,
      random,
      2,
      recentProblemIds
    );
  }

  if (mode === "explore") {
    return deprioritizeRecentlySeenProblems(
      explorationPool(uniqueProblemCandidates(problems), records).filter(
        (problem) => {
          const checkpointDue = records[problem.id]?.recallCheckpointDue;
          return !checkpointDue || isRepeatCheckpointDue(checkpointDue, now);
        }
      ),
      recentProblemIds
    );
  }

  const ordered = diversifiedSessionProblems(
    problems,
    records,
    now,
    options.randomize ?? false,
    random,
    policy.allowEarly
  );
  const establishedReady: ProblemSummary[] = [];
  const newReady: ProblemSummary[] = [];
  const future: ProblemSummary[] = [];
  for (const problem of ordered) {
    const record = records[problem.id];
    if (!isRecordReadyForReview(record, now)) {
      future.push(problem);
    } else if (hasReviewHistory(record)) {
      establishedReady.push(problem);
    } else {
      newReady.push(problem);
    }
  }
  return [
    ...deprioritizeRecentlySeenProblems(
      establishedReady,
      recentProblemIds
    ),
    ...deprioritizeRecentlySeenProblems(newReady, recentProblemIds),
    ...deprioritizeRecentlySeenProblems(future, recentProblemIds)
  ];
}

export function guidedSelectionReason(
  record: StudyRecord | undefined,
  now = new Date()
): string {
  if (isRepeatCheckpointDue(record?.recallCheckpointDue, now)) {
    return "Repeat 延遲驗收：0% 提示獨立重建";
  }
  if (record?.recallCheckpointDue) {
    const minutes = Math.max(
      1,
      Math.ceil(
        (Date.parse(record.recallCheckpointDue) - now.getTime()) /
          60_000
      )
    );
    return `Repeat 冷卻中：${minutes} 分鐘後進行 0% 驗收`;
  }
  if (!record?.fsrs) {
    return record?.status === "retry"
      ? "尚未建立排程，但上次需要重刷"
      : "新題：建立第一次無提示記憶";
  }
  if (
    record.status === "retry" ||
    record.fsrs.last_rating === "again"
  ) {
    return "這題先前作答失敗：已排入本輪重刷";
  }
  if (isDue(record.fsrs, now)) {
    return "記憶已到期：現在重新提取";
  }
  return "尚未到期：保留原排程";
}

export function mergeDueReviewsIntoQueue(
  problems: ProblemSummary[],
  records: Record<string, StudyRecord>,
  queue: string[],
  limit: number,
  now = new Date()
): string[] {
  const uniqueProblems = uniqueProblemCandidates(problems);
  const validProblemIds = uniqueProblems.map((problem) => problem.id);
  const normalizedQueue = normalizePracticeQueue(queue, validProblemIds);
  const dueReviewIds = orderProblemsForReview(uniqueProblems, records, now)
    .filter((problem) => {
      const card = records[problem.id]?.fsrs;
      const record = records[problem.id];
      return Boolean(
        card ||
          record?.recallCheckpointDue ||
          record?.status === "retry"
      ) &&
        isRecordReadyForReview(record, now);
    })
    .slice(0, limit || undefined)
    .map((problem) => problem.id);
  const dueSet = new Set(dueReviewIds);
  return [
    ...dueReviewIds,
    ...normalizedQueue.filter((id) => !dueSet.has(id))
  ];
}

export function insertDueReviewsAfterCurrent(
  problems: ProblemSummary[],
  records: Record<string, StudyRecord>,
  queue: string[],
  limit: number,
  now = new Date()
): string[] {
  const uniqueProblems = uniqueProblemCandidates(problems);
  const validProblemIds = uniqueProblems.map((problem) => problem.id);
  const normalizedQueue = normalizePracticeQueue(queue, validProblemIds);
  const queued = new Set(normalizedQueue);
  const newlyDue = orderProblemsForReview(uniqueProblems, records, now)
    .filter((problem) => {
      const card = records[problem.id]?.fsrs;
      const record = records[problem.id];
      return (
        Boolean(
          card ||
            record?.recallCheckpointDue ||
            record?.status === "retry"
        ) &&
        isRecordReadyForReview(record, now) &&
        !queued.has(problem.id)
      );
    })
    .slice(0, limit || undefined)
    .map((problem) => problem.id);

  if (!newlyDue.length) return normalizedQueue;
  if (!normalizedQueue.length) return newlyDue;
  return [
    normalizedQueue[0],
    ...newlyDue,
    ...normalizedQueue.slice(1)
  ];
}
