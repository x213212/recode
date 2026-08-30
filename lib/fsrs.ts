import type { FsrsCardData, FsrsRating } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MIN_INTERVAL_DAYS = 10 / (24 * 60);
const MAX_INTERVAL_DAYS = 36_500;

export const FSRS_ALGORITHM_VERSION = 7 as const;
export const FSRS_SCHEDULER_REVISION =
  "fsrs7-1053082-readme115-standard-v1" as const;
export const FSRS7_REFERENCE = {
  commit: "1053082bd2d6dbedbbd9674c4c9683c203f6818a",
  formula:
    "https://github.com/open-spaced-repetition/srs-benchmark/blob/1053082bd2d6dbedbbd9674c4c9683c203f6818a/models/fsrs_v7.py",
  parameters:
    "https://github.com/open-spaced-repetition/srs-benchmark/blob/1053082bd2d6dbedbbd9674c4c9683c203f6818a/README.md#default-parameters"
} as const;
// 0.95 是背單字等級的保留率，會把每個間隔壓短 30~50%；刷題改用 FSRS 標準 0.90。
export const FSRS_DESIRED_RETENTION = 0.9;
// 寫一題要 15~30 分鐘，[10,30] 分鐘學習步是背單字設定，只會讓同一題當天跳針；改成單步 1440 分（隔天），首次 Good 直接畢業進長期排程。
export const FSRS_LEARNING_STEPS_MINUTES = [1440] as const;
// 忘記後隔天重寫一次即可，不需要 10 分鐘內立刻再寫同一題。
export const FSRS_RELEARNING_STEPS_MINUTES = [1440] as const;

// Pinned to the published default-parameter table in FSRS7_REFERENCE.  At
// that same commit the executable prototype says 1.3 at w[15]/w[24], while
// the published table says 1.15.  Keep the documented 1.15 set: it is the
// conservative Easy bonus and the set existing cards were scheduled with.
// Changing it requires an explicit parameter revision decision, not a silent
// edit.  FSRS-7 uses fractional days, so same-day reviews contribute directly
// to the memory state instead of being rounded to zero days.
const FSRS7_PARAMETERS = [
  0.041, 2.4175, 4.1283, 11.9709,
  5.6385, 0.4468, 3.262,
  2.3054, 0.1688, 1.3325, 0.3524, 0.0049, 0.7503, 0.0896, 0.6625, 1.15,
  0.882, 0.3072, 3.5875, 0.303, 0.0107, 0.2279, 2.6413, 0.5594, 1.15,
  2.5, 1,
  0.0723, 0.1634, 0.5, 0.9555, 0.2245, 0.6232, 0.1362, 0.3862
] as const;

const CardState = {
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3
} as const;

type NumericRating = 1 | 2 | 3 | 4;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function numericRating(rating: FsrsRating): NumericRating {
  return {
    again: 1,
    hard: 2,
    good: 3,
    easy: 4
  }[rating] as NumericRating;
}

function initialDifficulty(rating: NumericRating): number {
  const w = FSRS7_PARAMETERS;
  return clamp(
    w[4] - Math.exp(w[5] * (rating - 1)) + 1,
    1,
    10
  );
}

function nextDifficulty(
  oldDifficulty: number,
  rating: NumericRating
): number {
  const w = FSRS7_PARAMETERS;
  const difficultyChange = -w[6] * (rating - 3);
  const dampedChange =
    difficultyChange * (10 - oldDifficulty) / 9;
  const changedDifficulty = oldDifficulty + dampedChange;

  // Official FSRS-7 mean reversion: pull the value 1% toward the default
  // Easy difficulty, then clamp only to the model's [1, 10] domain.
  return clamp(
    0.01 * initialDifficulty(4) + 0.99 * changedDifficulty,
    1,
    10
  );
}

export function fsrs7Retrievability(
  elapsedDays: number,
  stability: number
): number {
  const w = FSRS7_PARAMETERS;
  const safeStability = clamp(stability, 0.0001, MAX_INTERVAL_DAYS);
  const timeOverStability = Math.max(0, elapsedDays) / safeStability;

  const powerLaw = (
    base: number,
    decay: number
  ): number => {
    const factor = base ** (1 / decay) - 1;
    return (1 + factor * timeOverStability) ** decay;
  };

  const retention1 = powerLaw(w[29], -w[27]);
  const retention2 = powerLaw(w[30], -w[28]);
  const weight1 = w[31] * safeStability ** -w[33];
  const weight2 = w[32] * safeStability ** w[34];

  return clamp(
    (weight1 * retention1 + weight2 * retention2) /
      (weight1 + weight2),
    0,
    1
  );
}

function stabilityBranch(
  oldStability: number,
  oldDifficulty: number,
  currentRetrievability: number,
  rating: NumericRating,
  baseIndex: 7 | 16
): number {
  const w = FSRS7_PARAMETERS;
  const failedStability = Math.min(
    oldStability,
    w[baseIndex + 3] *
      oldDifficulty ** -w[baseIndex + 4] *
      ((oldStability + 1) ** w[baseIndex + 5] - 1) *
      Math.exp(
        (1 - currentRetrievability) * w[baseIndex + 6]
      )
  );

  if (rating === 1) return failedStability;

  const hardPenalty = rating === 2 ? w[baseIndex + 7] : 1;
  const easyBonus = rating === 4 ? w[baseIndex + 8] : 1;
  const stabilityIncrease =
    1 +
    Math.exp(w[baseIndex] - 1.5) *
      (11 - oldDifficulty) *
      oldStability ** -w[baseIndex + 1] *
      (Math.exp(
        (1 - currentRetrievability) * w[baseIndex + 2]
      ) - 1) *
      hardPenalty *
      easyBonus;

  return Math.max(
    failedStability,
    oldStability * stabilityIncrease
  );
}

function updateMemoryState(
  card: FsrsCardData,
  rating: NumericRating,
  elapsedDays: number
): { stability: number; difficulty: number } {
  const w = FSRS7_PARAMETERS;
  const currentRetrievability = fsrs7Retrievability(
    elapsedDays,
    card.stability
  );
  const longTermStability = stabilityBranch(
    card.stability,
    card.difficulty,
    currentRetrievability,
    rating,
    7
  );
  const shortTermStability = stabilityBranch(
    card.stability,
    card.difficulty,
    currentRetrievability,
    rating,
    16
  );

  // The actual elapsed fraction decides how much this review behaves like
  // same-day practice versus long-term recall.
  const longTermWeight = clamp(
    1 - w[26] * Math.exp(-w[25] * elapsedDays),
    0,
    1
  );
  const stability =
    longTermWeight * longTermStability +
    (1 - longTermWeight) * shortTermStability;

  return {
    stability: clamp(stability, 0.0001, MAX_INTERVAL_DAYS),
    difficulty: nextDifficulty(card.difficulty, rating)
  };
}

export function fsrs7IntervalForRetention(
  stability: number,
  desiredRetention = FSRS_DESIRED_RETENTION
): number {
  const target = clamp(desiredRetention, 0.7, 0.99);
  let lower = MIN_INTERVAL_DAYS;
  let upper = MAX_INTERVAL_DAYS;

  if (fsrs7Retrievability(lower, stability) <= target) {
    return lower;
  }
  if (fsrs7Retrievability(upper, stability) > target) {
    return upper;
  }

  // FSRS-7's mixed forgetting curve has no closed-form inverse.
  // Binary search in logarithmic time space finds t where R(t) = target.
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = Math.sqrt(lower * upper);
    if (fsrs7Retrievability(middle, stability) > target) {
      lower = middle;
    } else {
      upper = middle;
    }
  }

  return clamp(
    (lower + upper) / 2,
    MIN_INTERVAL_DAYS,
    MAX_INTERVAL_DAYS
  );
}

function learningStep(
  state: number,
  currentStep: number,
  rating: NumericRating
): { minutes: number; nextStep: number; state: number } | null {
  const relearning =
    state === CardState.Review || state === CardState.Relearning;
  // 以一般陣列型別處理，讓單步（[1440]）與多步設定共用同一套索引邏輯。
  const steps: readonly number[] = relearning
    ? FSRS_RELEARNING_STEPS_MINUTES
    : FSRS_LEARNING_STEPS_MINUTES;

  if (state === CardState.Review) {
    return rating === 1
      ? {
          minutes: steps[0],
          nextStep: 0,
          state: CardState.Relearning
        }
      : null;
  }

  if (rating === 1) {
    return {
      minutes: steps[0],
      nextStep: 0,
      state: relearning ? CardState.Relearning : CardState.Learning
    };
  }

  if (rating === 2) {
    const minutes =
      steps.length === 1
        ? Math.round(steps[0] * 1.5)
        : Math.round((steps[0] + steps[1]) / 2);
    return {
      minutes,
      nextStep: currentStep,
      state: relearning ? CardState.Relearning : CardState.Learning
    };
  }

  if (rating === 3) {
    // 單步陣列（[1440]）下 nextStep=1 不小於長度 1，Good 會直接畢業
    // 進入長期排程；多步陣列則照原本逐步前進，索引不會越界。
    const nextStep = currentStep + 1;
    if (nextStep < steps.length) {
      return {
        minutes: steps[nextStep],
        nextStep,
        state: relearning ? CardState.Relearning : CardState.Learning
      };
    }
  }

  return null;
}

function validDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

// 版本不符的舊卡承載的是真實練習歷史：clamp 到合法範圍後沿用
// stability／difficulty／reps／lapses，只更新版本欄；不再整批當新卡
// 歸零，避免升版當天所有題目同時「到期」跳針。
function adoptLegacyCard(
  existing: FsrsCardData
): FsrsCardData | undefined {
  const stability = Number(existing.stability);
  // 舊資料毫無可用的穩定度時才退回「當新卡」的原行為。
  if (!Number.isFinite(stability) || stability <= 0) return undefined;

  const difficulty = Number(existing.difficulty);
  const state = [
    CardState.New,
    CardState.Learning,
    CardState.Review,
    CardState.Relearning
  ].includes(existing.state as 0 | 1 | 2 | 3)
    ? existing.state
    : CardState.Review;

  return {
    ...existing,
    algorithm_version: FSRS_ALGORITHM_VERSION,
    scheduler_revision: FSRS_SCHEDULER_REVISION,
    stability: clamp(stability, 0.0001, MAX_INTERVAL_DAYS),
    difficulty: Number.isFinite(difficulty)
      ? clamp(difficulty, 1, 10)
      : initialDifficulty(3),
    reps: Math.max(0, Math.trunc(Number(existing.reps) || 0)),
    lapses: Math.max(0, Math.trunc(Number(existing.lapses) || 0)),
    // 學習步定義隨版本改變，一律重置到第一步以免索引越界。
    learning_steps: 0,
    state
  };
}

export function scheduleReview(
  existing: FsrsCardData | undefined,
  rating: FsrsRating,
  now = new Date()
): FsrsCardData {
  const grade = numericRating(rating);
  const isFsrs7 = existing?.algorithm_version === FSRS_ALGORITHM_VERSION;
  // 舊版卡片改為沿用記憶狀態（clamp 後）續排，而不是直接當新卡。
  const currentCard = existing
    ? isFsrs7
      ? existing
      : adoptLegacyCard(existing)
    : undefined;
  const previousReview = validDate(currentCard?.last_review);
  const elapsedDays = previousReview
    ? Math.max(0, (now.getTime() - previousReview.getTime()) / DAY_MS)
    : 0;

  const memory = currentCard
    ? updateMemoryState(currentCard, grade, elapsedDays)
    : {
        stability: FSRS7_PARAMETERS[grade - 1],
        difficulty: initialDifficulty(grade)
      };
  const previousState = currentCard?.state ?? CardState.New;
  const shortStep = learningStep(
    previousState,
    currentCard?.learning_steps ?? 0,
    grade
  );
  const scheduledDays = shortStep
    ? shortStep.minutes / (24 * 60)
    : fsrs7IntervalForRetention(memory.stability);
  const due = new Date(now.getTime() + scheduledDays * DAY_MS);
  const wasReviewLapse =
    previousState === CardState.Review && grade === 1;

  return {
    algorithm_version: FSRS_ALGORITHM_VERSION,
    scheduler_revision: FSRS_SCHEDULER_REVISION,
    last_rating: rating,
    due: due.toISOString(),
    stability: memory.stability,
    difficulty: memory.difficulty,
    elapsed_days: elapsedDays,
    scheduled_days: scheduledDays,
    learning_steps: shortStep?.nextStep ?? 0,
    reps: (currentCard?.reps ?? 0) + 1,
    lapses:
      (currentCard?.lapses ?? 0) + (wasReviewLapse ? 1 : 0),
    state: shortStep?.state ?? CardState.Review,
    last_review: now.toISOString()
  };
}

export function retrievability(
  existing: FsrsCardData | undefined,
  now = new Date()
): number {
  // 版本不符的舊卡不再一律回 0：其穩定度仍是可用的記憶估計，照常推算。
  if (!existing || existing.state === CardState.New) {
    return 0;
  }
  const stability = Number(existing.stability);
  if (!Number.isFinite(stability) || stability <= 0) return 0;
  const lastReview = validDate(existing.last_review);
  if (!lastReview) return 0;
  const elapsedDays = Math.max(
    0,
    (now.getTime() - lastReview.getTime()) / DAY_MS
  );
  return fsrs7Retrievability(elapsedDays, stability);
}

export function isDue(
  existing: FsrsCardData | undefined,
  now = new Date()
): boolean {
  if (!existing) return true;
  // 版本不符不再視為立即到期：沿用原排程 due，避免升版當天全部舊題湧入佇列。
  const due = new Date(existing.due).getTime();
  return !Number.isFinite(due) || due <= now.getTime();
}

export function formatDue(
  existing: FsrsCardData | undefined,
  now = new Date()
): string {
  if (!existing) return "尚未排程";
  // 版本不符的舊卡沿用原 due 顯示，不再顯示「待重新校準」造成整批到期的錯覺。
  const due = new Date(existing.due);
  if (!Number.isFinite(due.getTime())) return "現在到期";
  const diff = due.getTime() - now.getTime();
  if (diff <= 0) return "現在到期";
  const minutes = Math.ceil(diff / MINUTE_MS);
  if (minutes < 60) return `${minutes} 分鐘後`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} 小時後`;
  return `${Math.ceil(hours / 24)} 天後`;
}

export function formatFsrsRating(
  rating: FsrsRating | undefined
): string {
  if (!rating) return "待觀測";
  return {
    again: "忘記",
    hard: "不穩",
    good: "穩定",
    easy: "熟練"
  }[rating];
}

export function familiarityLabel(
  card: FsrsCardData | undefined,
  now = new Date()
): string {
  if (!card || card.algorithm_version !== FSRS_ALGORITHM_VERSION) {
    return "待觀測";
  }
  if (card.state === CardState.Relearning || card.last_rating === "again") {
    return "需重練";
  }
  if (card.state === CardState.Learning) return "建立中";
  if (card.last_rating === "hard") return "不穩";

  const memory = retrievability(card, now);
  if (card.reps >= 5 && card.stability >= 30 && memory >= 0.9) {
    return "穩固";
  }
  if (card.reps >= 3 && card.stability >= 7 && memory >= 0.85) {
    return "熟悉";
  }
  return "建立中";
}
