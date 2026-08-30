import { reviewSessionProblems } from "./review.ts";
import type { Difficulty, ProblemSummary, StudyRecord } from "./types.ts";

// 60 秒寫完一題不現實（一題通常要 15~30 分鐘）；預設放寬到 5 分鐘。
export const DEFAULT_SPEED_QUESTION_SECONDS = 300;
export const MIN_SPEED_QUESTION_SECONDS = 10;
export const MAX_SPEED_QUESTION_SECONDS = 600;
export const SPEED_QUESTION_LIMIT_MS =
  DEFAULT_SPEED_QUESTION_SECONDS * 1000;

export function normalizeSpeedQuestionSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_SPEED_QUESTION_SECONDS;
  return Math.min(
    MAX_SPEED_QUESTION_SECONDS,
    Math.max(MIN_SPEED_QUESTION_SECONDS, Math.round(seconds))
  );
}

export function speedQuestionLimitMs(seconds: unknown): number {
  return normalizeSpeedQuestionSeconds(seconds) * 1000;
}

export type SpeedTimerTone = "safe" | "warning" | "danger";

export interface SpeedCategoryStats {
  solved: number;
  timedOut: number;
  wrongAttempts: number;
  points: number;
}

export interface SpeedSessionState {
  phase: "setup" | "running" | "timeout" | "finished";
  questionLimitMs: number;
  total: number;
  score: number;
  solved: number;
  timedOut: number;
  wrongAttempts: number;
  deadlineAt?: number;
  questionId?: string;
  categories: Record<string, SpeedCategoryStats>;
}

export interface SpeedAnswerPolicy {
  answerOpen: boolean;
  answerReferenceOpen: boolean;
  explanationOpen: false;
}

/** 每一題開始前都重新套用，避免上一題超時開啟的答案洩漏到下一題。 */
export function speedAnswerPolicy(
  solutionVisible: boolean
): SpeedAnswerPolicy {
  return {
    answerOpen: solutionVisible,
    answerReferenceOpen: solutionVisible,
    explanationOpen: false
  };
}

export function speedSubmissionCanAdvance(input: {
  submittedInTime: boolean;
  timeoutRewrite: boolean;
  solutionVisible: boolean;
}): boolean {
  return (
    input.submittedInTime ||
    input.timeoutRewrite ||
    input.solutionVisible
  );
}

export function emptySpeedSession(
  questionLimitMs = SPEED_QUESTION_LIMIT_MS
): SpeedSessionState {
  return {
    phase: "setup",
    questionLimitMs: Math.max(1_000, Math.round(questionLimitMs)),
    total: 0,
    score: 0,
    solved: 0,
    timedOut: 0,
    wrongAttempts: 0,
    categories: {}
  };
}

export function normalizeSpeedSession(
  value: unknown,
  questionLimitMs = SPEED_QUESTION_LIMIT_MS
): SpeedSessionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptySpeedSession(questionLimitMs);
  }
  const input = value as Partial<SpeedSessionState>;
  const phase =
    input.phase === "running" ||
    input.phase === "timeout" ||
    input.phase === "finished"
      ? input.phase
      : "setup";
  const categories =
    input.categories &&
    typeof input.categories === "object" &&
    !Array.isArray(input.categories)
      ? Object.fromEntries(
          Object.entries(input.categories).map(([category, stats]) => {
            const item = stats as Partial<SpeedCategoryStats>;
            return [
              category,
              {
                solved: Math.max(0, Number(item.solved) || 0),
                timedOut: Math.max(0, Number(item.timedOut) || 0),
                wrongAttempts: Math.max(
                  0,
                  Number(item.wrongAttempts) || 0
                ),
                points: Math.max(0, Number(item.points) || 0)
              }
            ];
          })
        )
      : {};

  return {
    phase,
    questionLimitMs: Math.max(
      1_000,
      Number(input.questionLimitMs) || questionLimitMs
    ),
    total: Math.max(0, Number(input.total) || 0),
    score: Math.max(0, Number(input.score) || 0),
    solved: Math.max(0, Number(input.solved) || 0),
    timedOut: Math.max(0, Number(input.timedOut) || 0),
    wrongAttempts: Math.max(0, Number(input.wrongAttempts) || 0),
    ...(Number.isFinite(input.deadlineAt)
      ? { deadlineAt: Number(input.deadlineAt) }
      : {}),
    ...(typeof input.questionId === "string" && input.questionId
      ? { questionId: input.questionId }
      : {}),
    categories
  };
}

export function speedQueue(
  problems: ProblemSummary[],
  records: Record<string, StudyRecord>,
  limit: number,
  now = new Date()
): ProblemSummary[] {
  // Speed 只從「現在可以練」的池子抽題：已到期卡、Repeat 延遲驗收、
  // 以及尚未建立 FSRS 的新題。未到期卡不會為了湊題數被提前抽出來。
  const ready = reviewSessionProblems(
    problems,
    records,
    false,
    now
  );
  return limit > 0 ? ready.slice(0, limit) : ready;
}

export function speedTimerTone(
  remainingMs: number,
  limitMs = SPEED_QUESTION_LIMIT_MS
): SpeedTimerTone {
  const ratio = Math.max(0, remainingMs) / Math.max(1, limitMs);
  if (ratio > 0.5) return "safe";
  if (ratio > 0.2) return "warning";
  return "danger";
}

export function speedScore(
  difficulty: Difficulty,
  remainingMs: number,
  limitMs = SPEED_QUESTION_LIMIT_MS
): number {
  const base = {
    easy: 100,
    medium: 160,
    hard: 240,
    unknown: 130
  }[difficulty];
  // 0 秒仍保留題目本身的分數；最多拿到一個基礎分的速度 bonus。
  const ratio = Math.max(0, Math.min(1, remainingMs / Math.max(1, limitMs)));
  return base + Math.round(base * ratio);
}

export function nextSpeedCategoryStats(
  current: Record<string, SpeedCategoryStats>,
  category: string,
  update: Partial<SpeedCategoryStats>
): Record<string, SpeedCategoryStats> {
  const previous = current[category] ?? {
    solved: 0,
    timedOut: 0,
    wrongAttempts: 0,
    points: 0
  };
  return {
    ...current,
    [category]: {
      solved: previous.solved + (update.solved ?? 0),
      timedOut: previous.timedOut + (update.timedOut ?? 0),
      wrongAttempts: previous.wrongAttempts + (update.wrongAttempts ?? 0),
      points: previous.points + (update.points ?? 0)
    }
  };
}
