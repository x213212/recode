import type { AnswerRevealMode } from "@/lib/types";

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 30;
  return Math.min(100, Math.max(10, Math.round(percent)));
}

function isScaffoldLine(line: string): boolean {
  return /^(?:@\w+|class\s+|(?:async\s+)?def\s+)/.test(line.trim());
}

export function normalizeAnswerPercent(percent: number): number {
  return Math.min(100, Math.max(10, Math.round(percent / 10) * 10));
}

function longestLineLength(value: string): number {
  return value
    .split("\n")
    .reduce((longest, line) => Math.max(longest, line.length), 0);
}

export function answerScrollPaddingColumns(
  answer: string,
  editorCode: string,
  minimum = 5
): number {
  const extraColumns =
    longestLineLength(answer) - longestLineLength(editorCode);
  return Math.max(minimum, extraColumns + minimum);
}

export function answerScrollPaddingLines(
  answer: string,
  editorCode: string,
  minimum = 2
): number {
  const answerLines = answer ? answer.split("\n").length : 0;
  const editorLines = editorCode ? editorCode.split("\n").length : 0;
  return Math.max(minimum, answerLines - editorLines + minimum);
}

export interface AdaptiveAnswerEvidence {
  successfulSubmissions: number;
  recentFailedSubmissions?: number;
  status?: "new" | "learning" | "retry" | "completed" | "mastered";
  retrievability?: number;
}

export interface AnswerDisplayPolicyInput {
  canReveal: boolean;
  answerOpen: boolean;
  comparisonOpen: boolean;
  forceOverlay: boolean;
  hasAnswer: boolean;
}

/**
 * 半透明提示與並排對照是兩個不同功能。
 *
 * answerOpen 決定答案底稿是否存在；comparisonOpen 只能把已存在的
 * 底稿改成左右並排，不能反過來控制底稿。Repeat 會用 forceOverlay
 * 強制顯示該輪提示，但仍不應自動切成並排。
 */
export function answerDisplayPolicy(
  input: AnswerDisplayPolicyInput
): {
  overlayVisible: boolean;
  comparisonVisible: boolean;
} {
  const overlayVisible =
    input.canReveal &&
    input.hasAnswer &&
    (input.answerOpen || input.forceOverlay);

  return {
    overlayVisible,
    comparisonVisible:
      overlayVisible &&
      input.answerOpen &&
      input.comparisonOpen &&
      !input.forceOverlay
  };
}

/**
 * 把「看答案的量」和真正的熟練度分開。
 *
 * AC 後固定走 100 → 75 → 50 → 25 → 10；這一階梯讓使用者能預測
 * 下一次會少掉多少提示。若本題剛失敗或 FSRS 判定記憶已很低，則暫時
 * 回升提示量，避免一題卡住時仍硬藏答案。
 */
export function adaptiveAnswerPercent(
  input: number | AdaptiveAnswerEvidence
): number {
  const evidence =
    typeof input === "number"
      ? { successfulSubmissions: input }
      : input;
  const successes = Math.max(
    0,
    Math.floor(evidence.successfulSubmissions)
  );
  const levels = [100, 75, 50, 25, 10];
  let percent = levels[Math.min(successes, levels.length - 1)];

  const recentFailures = Math.max(
    0,
    evidence.recentFailedSubmissions ?? 0
  );
  if (evidence.status === "retry" || recentFailures > 0) {
    percent = Math.max(percent, 75);
  }

  const memory = evidence.retrievability;
  if (typeof memory === "number" && Number.isFinite(memory)) {
    if (memory < 0.35) percent = Math.max(percent, 75);
    else if (memory < 0.55) percent = Math.max(percent, 50);
  }

  return clampPercent(percent);
}

export function answerLineForCompletion(
  revealedAnswer: string,
  lineNumber: number
): string | undefined {
  if (!revealedAnswer || lineNumber < 1) return undefined;
  const line = revealedAnswer.split("\n")[lineNumber - 1];
  return line?.trim() ? line : undefined;
}

export function buildRevealedAnswer(
  answer: string,
  mode: AnswerRevealMode,
  percent: number,
  problemId: string,
  seed: number
): string {
  const revealPercent = clampPercent(percent);
  if (!answer || mode === "full" || revealPercent === 100) return answer;

  const lines = answer.split("\n");
  const scaffold = new Set<number>();
  let candidates = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => {
      if (!line.trim()) return false;
      if (isScaffoldLine(line)) {
        scaffold.add(index);
        return false;
      }
      return true;
    })
    .map(({ index }) => index);

  if (!candidates.length) {
    candidates = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.trim())
      .map(({ index }) => index);
  }

  const visibleCount = Math.max(
    1,
    Math.ceil((candidates.length * revealPercent) / 100)
  );
  const rankedCandidates = candidates
    .map((index) => ({
      index,
      rank: stableHash(`${problemId}:${index}:${lines[index]}`)
    }))
    .sort((first, second) => first.rank - second.rank)
    .map(({ index }) => index);
  const offset =
    rankedCandidates.length > 0
      ? ((Math.floor(seed) % rankedCandidates.length) +
          rankedCandidates.length) %
        rankedCandidates.length
      : 0;
  const rotatedCandidates = [
    ...rankedCandidates.slice(offset),
    ...rankedCandidates.slice(0, offset)
  ];
  const visible = new Set(rotatedCandidates.slice(0, visibleCount));

  return lines
    .map((line, index) =>
      !line.trim() || scaffold.has(index) || visible.has(index)
        ? line
        : line.replace(/\S/g, " ")
    )
    .join("\n");
}
