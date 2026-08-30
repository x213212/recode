import type {
  PracticeMode,
  ReviewOrigin,
  SubmissionEvent,
  StudyRecord,
  StudyStatus
} from "./types.ts";
import { scheduleReview } from "./fsrs.ts";

export type MemoryEvidenceReason =
  NonNullable<SubmissionEvent["memoryEvidenceReason"]>;

export interface SubmissionMemoryContext {
  mode: PracticeMode;
  reviewOrigin?: ReviewOrigin;
  answerRevealCount: number;
  speedSubmittedInTime?: boolean;
  speedWasTimeoutRewrite?: boolean;
  speedSolutionWasVisible?: boolean;
  speedSubmittedLate?: boolean;
}

export interface SubmissionMemoryPolicy {
  /**
   * 這筆提交是否能加入下一次記憶評分的證據鏈。
   * false 只代表「有協助」，不代表這筆練習紀錄要被刪除。
   */
  memoryEligible: boolean;
  /**
   * 本次 AC 是否可以真正呼叫 FSRS。失敗事件即使可作為證據，
   * 也會等同一回合之後的無提示 AC 再一起評分。
   */
  canScheduleAcceptedReview: boolean;
  reason: MemoryEvidenceReason;
}

/**
 * 記憶模型只接受真正的提取證據。
 *
 * Repeat、已開答案的 Speed、超時重打與任何看過答案的提交，
 * 都可以留在提交紀錄，但不可冒充一次獨立回想成功。
 */
export function submissionMemoryPolicy(
  context: SubmissionMemoryContext
): SubmissionMemoryPolicy {
  if (context.mode === "repeat") {
    return {
      memoryEligible: false,
      canScheduleAcceptedReview: false,
      reason: "repeat-guided"
    };
  }

  if (context.mode === "speed") {
    if (context.speedWasTimeoutRewrite) {
      return {
        memoryEligible: false,
        canScheduleAcceptedReview: false,
        reason: "speed-timeout-rewrite"
      };
    }
    if (context.speedSolutionWasVisible) {
      return {
        memoryEligible: false,
        canScheduleAcceptedReview: false,
        reason: "speed-answer-visible"
      };
    }
    if (context.speedSubmittedLate || !context.speedSubmittedInTime) {
      return {
        memoryEligible: false,
        canScheduleAcceptedReview: false,
        reason: "speed-late-submit"
      };
    }
  }

  if (context.answerRevealCount > 0) {
    return {
      memoryEligible: false,
      canScheduleAcceptedReview: false,
      reason: "answer-assisted"
    };
  }

  if (context.reviewOrigin === "same-session") {
    return {
      memoryEligible: false,
      canScheduleAcceptedReview: false,
      reason: "same-session-repeat"
    };
  }

  if (context.reviewOrigin === "early") {
    return {
      memoryEligible: false,
      canScheduleAcceptedReview: false,
      reason: "early-review"
    };
  }

  if (
    context.reviewOrigin === "manual" ||
    context.mode === "explore"
  ) {
    return {
      memoryEligible: false,
      canScheduleAcceptedReview: false,
      reason: "manual-review"
    };
  }

  return {
    memoryEligible: true,
    canScheduleAcceptedReview: true,
    reason: "independent-recall"
  };
}

/**
 * 舊事件沒有 memoryEligible。若舊資料明確記錄看過答案，就能確定
 * 它不是獨立提取；其他舊事件保留，避免猜錯後刪掉真實 AC。
 */
export function isMemoryEligibleSubmission(
  event: SubmissionEvent
): boolean {
  if (typeof event.memoryEligible === "boolean") {
    return event.memoryEligible;
  }
  if (
    event.practiceMode === "repeat" ||
    event.memoryEvidenceReason === "repeat-guided" ||
    event.memoryEvidenceReason === "speed-answer-visible" ||
    event.memoryEvidenceReason === "speed-timeout-rewrite" ||
    event.memoryEvidenceReason === "speed-late-submit" ||
    event.memoryEvidenceReason === "early-review" ||
    event.memoryEvidenceReason === "same-session-repeat" ||
    event.memoryEvidenceReason === "manual-review" ||
    event.memoryEvidenceReason === "answer-assisted" ||
    event.memoryEvidenceReason === "legacy-assisted"
  ) {
    return false;
  }
  return (event.answerRevealCount ?? 0) === 0;
}

/**
 * 在題目開始時快照排程來源。之後即使同一回合 WA 把狀態改成 retry，
 * 來源也不會漂移；是否能寫 FSRS 因而不依賴 UI queue。
 */
export function reviewOriginForRecord(
  record: StudyRecord | undefined,
  mode: PracticeMode,
  now = new Date()
): ReviewOrigin {
  if (mode === "explore") return "manual";
  const checkpointAt = record?.recallCheckpointDue
    ? Date.parse(record.recallCheckpointDue)
    : Number.NaN;
  if (Number.isFinite(checkpointAt)) {
    return checkpointAt <= now.getTime() ? "checkpoint-due" : "early";
  }
  if (record?.status === "retry") return "retry";
  if (!record?.fsrs) return "new";
  const dueAt = Date.parse(record.fsrs.due);
  return Number.isFinite(dueAt) && dueAt <= now.getTime()
    ? "fsrs-due"
    : "early";
}

export function submissionEvidenceCounts(
  history: SubmissionEvent[],
  problemId: string
): {
  memoryPassed: number;
  assistedPassed: number;
} {
  let memoryPassed = 0;
  let assistedPassed = 0;

  for (const event of history) {
    if (event.problemId !== problemId || !event.passed) continue;
    if (isMemoryEligibleSubmission(event)) memoryPassed += 1;
    else assistedPassed += 1;
  }

  return { memoryPassed, assistedPassed };
}

export function submissionEvidenceCountMap(
  history: SubmissionEvent[]
): Map<string, { memoryPassed: number; assistedPassed: number }> {
  const counts = new Map<
    string,
    { memoryPassed: number; assistedPassed: number }
  >();

  for (const event of history) {
    if (!event.passed) continue;
    const current = counts.get(event.problemId) ?? {
      memoryPassed: 0,
      assistedPassed: 0
    };
    if (isMemoryEligibleSubmission(event)) current.memoryPassed += 1;
    else current.assistedPassed += 1;
    counts.set(event.problemId, current);
  }

  return counts;
}

export function memoryEligiblePassCount(
  history: SubmissionEvent[],
  problemId: string
): number {
  return history.reduce(
    (total, event) =>
      total +
      Number(
        event.problemId === problemId &&
          event.passed &&
          isMemoryEligibleSubmission(event)
      ),
    0
  );
}

export function recentMemoryFailureCount(
  history: SubmissionEvent[],
  problemId: string,
  reviewedAfter?: string
): number {
  let failures = 0;
  const cutoff = reviewedAfter
    ? Date.parse(reviewedAfter)
    : Number.NaN;

  for (const event of history) {
    if (
      event.problemId !== problemId ||
      !isMemoryEligibleSubmission(event)
    ) {
      continue;
    }
    if (
      Number.isFinite(cutoff) &&
      Date.parse(event.submittedAt) <= cutoff
    ) {
      break;
    }
    if (event.passed) break;
    failures += 1;
  }

  return failures;
}

export function statusAfterSubmissionEvidence(input: {
  currentStatus: StudyStatus;
  passed: boolean;
  memoryEligible: boolean;
  acceptedStatus: StudyStatus;
}): StudyStatus {
  if (!input.memoryEligible) {
    return input.currentStatus === "new"
      ? "learning"
      : input.currentStatus;
  }
  return input.passed ? input.acceptedStatus : "retry";
}

export interface MemoryRepairReport {
  assistedEvents: number;
  rebuiltCards: number;
  /**
   * 保留欄位以相容既有報表格式。重建改為「補強不取代」後，
   * 無法重建的卡片一律保留原 FSRS，不再清除，此值恆為 0。
   */
  clearedCards: number;
  discardedUnmatchedReviews: number;
}

/**
 * 只用可驗證的無提示事件重建（補強）FSRS。
 *
 * 有可重放證據（帶 inferredRating 的無提示提交）時，以重放結果覆寫
 * FSRS；沒有證據時「保留原卡不動」。舊版曾在無證據時直接刪除
 * record.fsrs，導致 schema 升版重跑本函式時，把舊事件缺 inferredRating
 * 或歷史被截斷的題目整批歸零、既有排程全數遺失——重建只能補強，
 * 不能取代使用者既有的排程資料。
 */
export function rebuildMemoryCards(
  records: Record<string, StudyRecord>,
  history: SubmissionEvent[]
): {
  records: Record<string, StudyRecord>;
  report: MemoryRepairReport;
} {
  const report: MemoryRepairReport = {
    assistedEvents: history.filter(
      (event) => !isMemoryEligibleSubmission(event)
    ).length,
    rebuiltCards: 0,
    clearedCards: 0,
    discardedUnmatchedReviews: 0
  };
  const ratedByProblem = new Map<string, SubmissionEvent[]>();
  const evidenceByProblem = submissionEvidenceCountMap(history);

  for (const event of history) {
    if (!event.inferredRating) continue;
    const events = ratedByProblem.get(event.problemId) ?? [];
    events.push(event);
    ratedByProblem.set(event.problemId, events);
  }

  const repaired: Record<string, StudyRecord> = {};

  for (const [problemId, record] of Object.entries(records)) {
    const rated = (ratedByProblem.get(problemId) ?? []).sort(
      (left, right) =>
        Date.parse(left.submittedAt) - Date.parse(right.submittedAt)
    );
    let rebuilt: StudyRecord["fsrs"];

    for (const event of rated) {
      if (
        !event.inferredRating ||
        !isMemoryEligibleSubmission(event)
      ) {
        continue;
      }
      const submittedAt = new Date(event.submittedAt);
      if (!Number.isFinite(submittedAt.getTime())) continue;
      rebuilt = scheduleReview(
        rebuilt,
        event.inferredRating,
        submittedAt
      );
    }

    const existingReviewAt = record.fsrs?.last_review
      ? Date.parse(record.fsrs.last_review)
      : Number.NaN;
    const rebuiltReviewAt = rebuilt?.last_review
      ? Date.parse(rebuilt.last_review)
      : Number.NaN;
    if (
      Number.isFinite(existingReviewAt) &&
      (!Number.isFinite(rebuiltReviewAt) ||
        Math.abs(existingReviewAt - rebuiltReviewAt) > 2_000)
    ) {
      report.discardedUnmatchedReviews += 1;
    }

    const evidence = evidenceByProblem.get(problemId) ?? {
      memoryPassed: 0,
      assistedPassed: 0
    };
    const nextRecord: StudyRecord = {
      ...record,
      memoryPassed: evidence.memoryPassed,
      assistedPassed: evidence.assistedPassed
    };
    if (rebuilt) {
      nextRecord.fsrs = rebuilt;
      report.rebuiltCards += 1;
    } else {
      // 重建必須是「補強不取代」：rebuilt 為 undefined 只代表歷史裡
      // 找不到可重放的證據——舊版事件沒有 inferredRating 欄位、或
      // submissionHistory 已被 20000 筆上限截斷——並不代表這張卡片
      // 是假的。schema 升版會對整份 records 跑一次本函式，若在這裡
      // 刪掉 record.fsrs，使用者累積多年的 FSRS 排程會在升版當下被
      // 整批歸零。因此保留原本的 record.fsrs 不動（nextRecord 由
      // ...record 展開而來，原卡片自然留存），只有真的重建出新卡時
      // 才覆寫。
      if (
        !record.fsrs &&
        evidence.assistedPassed > 0 &&
        evidence.memoryPassed === 0 &&
        (nextRecord.status === "completed" ||
          nextRecord.status === "mastered")
      ) {
        nextRecord.status = "learning";
      }
    }
    repaired[problemId] = nextRecord;
  }

  return { records: repaired, report };
}
