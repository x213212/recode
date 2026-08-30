import {
  independentPassCount,
  isRecordReadyForReview,
  orderProblemsForReview
} from "./review.ts";
import { recallStudyDateKey } from "./recallRound.ts";
import type {
  CompletedTrainingDay,
  DailyTrainingBlock,
  DailyTrainingPlan,
  PracticeMode,
  ProblemSummary,
  StudyRecord,
  TrainingBlockKind,
  TrainingMenuSize,
  TrainingPlanPhase,
  TrainingProgramState
} from "./types.ts";

export const TRAINING_PLAN_DAYS = 30;

// Source tags a problem can carry. They are neutral on purpose: a study list's
// name belongs to whoever published it, and this repository ships no problems
// from one. Tag your own set with whatever these say, or edit them.
export const CORE_TRAINING_SOURCES = [
  "Core 75",
  "Classic 75",
  "Extended 150"
] as const;

export interface TrainingMenuPreset {
  label: string;
  estimatedMinutes: number;
  recall: number;
  learn: number;
  transfer: number;
  speed: number;
  interview: number;
}

export const TRAINING_MENU_PRESETS: Record<
  TrainingMenuSize,
  TrainingMenuPreset
> = {
  light: {
    label: "輕量",
    estimatedMinutes: 45,
    recall: 2,
    learn: 1,
    transfer: 0,
    speed: 1,
    interview: 1
  },
  standard: {
    label: "標準",
    estimatedMinutes: 120,
    recall: 4,
    learn: 2,
    transfer: 1,
    speed: 2,
    interview: 1
  },
  intensive: {
    label: "特訓",
    estimatedMinutes: 240,
    recall: 8,
    learn: 4,
    transfer: 2,
    speed: 3,
    interview: 2
  }
};

const DAY_FOCUS: string[][] = [
  ["陣列與 Hash"],
  ["雙指標"],
  ["滑動視窗"],
  ["Stack／單調 Stack"],
  ["二分搜尋"],
  ["鏈結串列"],
  [],
  ["二元樹與 BST"],
  ["二元樹與 BST"],
  ["圖"],
  ["圖"],
  ["回溯"],
  ["Heap／優先佇列"],
  [],
  ["貪婪"],
  ["區間"],
  ["一維 DP"],
  ["二維 DP"],
  ["Prefix Sum", "位元操作"],
  ["Trie", "Queue"],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  []
];

const BLOCK_COPY: Record<
  TrainingBlockKind,
  { mode: PracticeMode; title: string; purpose: string }
> = {
  recall: {
    mode: "guided",
    title: "到期提取",
    purpose: "完全不看答案，把已到期的舊題從長期記憶重新拿出來。"
  },
  learn: {
    mode: "free",
    title: "今日主題",
    purpose: "集中建立同一個 pattern；卡住時可以逐步查看推導。"
  },
  transfer: {
    mode: "free",
    title: "陌生變形",
    purpose: "換一題同類型的新題，確認記住的是方法而不是原題。"
  },
  speed: {
    mode: "speed",
    title: "骨架反射",
    purpose: "只拿已獨立解過且目前到期的題，練習快速重建主幹。"
  },
  interview: {
    mode: "interview",
    title: "計時模擬",
    purpose: "不顯示分類提示與答案，完整走一次面試解題流程。"
  }
};

export function trainingDateKey(
  value: Date | number | string = new Date()
): string {
  return recallStudyDateKey(value);
}

export function emptyTrainingProgram(): TrainingProgramState {
  return {
    preset: "standard",
    completedDays: {}
  };
}

function isMenuSize(value: unknown): value is TrainingMenuSize {
  return value === "light" || value === "standard" || value === "intensive";
}

function isPlanPhase(value: unknown): value is TrainingPlanPhase {
  return (
    value === "foundation" ||
    value === "patterns" ||
    value === "transfer" ||
    value === "interview"
  );
}

function isBlockKind(value: unknown): value is TrainingBlockKind {
  return (
    value === "recall" ||
    value === "learn" ||
    value === "transfer" ||
    value === "speed" ||
    value === "interview"
  );
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeTrainingBlock(value: unknown): DailyTrainingBlock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Partial<DailyTrainingBlock>;
  if (
    typeof input.id !== "string" ||
    !isBlockKind(input.kind) ||
    typeof input.title !== "string"
  ) {
    return null;
  }
  const copy = BLOCK_COPY[input.kind];
  const problemIds = normalizeStringArray(input.problemIds);
  const remainingProblemIds = normalizeStringArray(
    input.remainingProblemIds
  ).filter((id) => problemIds.includes(id));
  return {
    id: input.id,
    kind: input.kind,
    mode: copy.mode,
    title: input.title || copy.title,
    purpose:
      typeof input.purpose === "string" ? input.purpose : copy.purpose,
    targetCount: Math.max(
      problemIds.length,
      Math.floor(Number(input.targetCount) || 0)
    ),
    problemIds,
    remainingProblemIds,
    status:
      input.status === "running" || input.status === "completed"
        ? input.status
        : "pending"
  };
}

function normalizeTrainingPlan(value: unknown): DailyTrainingPlan | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Partial<DailyTrainingPlan>;
  if (
    typeof input.id !== "string" ||
    typeof input.date !== "string" ||
    !isMenuSize(input.preset) ||
    !isPlanPhase(input.phase)
  ) {
    return undefined;
  }
  const blocks = Array.isArray(input.blocks)
    ? input.blocks
        .map(normalizeTrainingBlock)
        .filter((block): block is DailyTrainingBlock => Boolean(block))
    : [];
  const activeBlockIndex = Math.min(
    Math.max(0, Math.floor(Number(input.activeBlockIndex) || 0)),
    Math.max(0, blocks.length - 1)
  );
  return {
    id: input.id,
    date: input.date,
    planDay: Math.min(
      TRAINING_PLAN_DAYS,
      Math.max(1, Math.floor(Number(input.planDay) || 1))
    ),
    phase: input.phase,
    focusCategories: normalizeStringArray(input.focusCategories),
    preset: input.preset,
    estimatedMinutes: Math.max(
      1,
      Math.floor(
        Number(input.estimatedMinutes) ||
          TRAINING_MENU_PRESETS[input.preset].estimatedMinutes
      )
    ),
    status:
      input.status === "running" ||
      input.status === "paused" ||
      input.status === "completed"
        ? input.status
        : "ready",
    activeBlockIndex,
    blocks,
    createdAt:
      typeof input.createdAt === "string"
        ? input.createdAt
        : new Date().toISOString(),
    ...(typeof input.completedAt === "string"
      ? { completedAt: input.completedAt }
      : {})
  };
}

function normalizeCompletedDays(
  value: unknown
): Record<string, CompletedTrainingDay> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, CompletedTrainingDay> = {};
  for (const [date, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Partial<CompletedTrainingDay>;
    if (
      !isMenuSize(item.preset) ||
      typeof item.completedAt !== "string"
    ) {
      continue;
    }
    result[date] = {
      planDay: Math.min(
        TRAINING_PLAN_DAYS,
        Math.max(1, Math.floor(Number(item.planDay) || 1))
      ),
      preset: item.preset,
      completedAt: item.completedAt,
      completedBlocks: Math.max(
        0,
        Math.floor(Number(item.completedBlocks) || 0)
      ),
      problemCount: Math.max(
        0,
        Math.floor(Number(item.problemCount) || 0)
      )
    };
  }
  return result;
}

export function normalizeTrainingProgram(
  value: unknown
): TrainingProgramState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyTrainingProgram();
  }
  const input = value as Partial<TrainingProgramState>;
  const activePlan = normalizeTrainingPlan(input.activePlan);
  return {
    preset: isMenuSize(input.preset) ? input.preset : "standard",
    ...(typeof input.startedOn === "string"
      ? { startedOn: input.startedOn }
      : {}),
    ...(activePlan ? { activePlan } : {}),
    completedDays: normalizeCompletedDays(input.completedDays)
  };
}

export function nextTrainingDay(
  program: TrainingProgramState,
  _now: Date | number | string = new Date()
): number {
  const completedDay = Math.max(
    0,
    ...Object.values(program.completedDays).map((day) => day.planDay)
  );
  // 只開始、跳過或半途離開都不是完成；30 日進度只能由 completedDays
  // 推進。昨日未完成內容由 trainingPlanForDate 安全滾到今天續做。
  return Math.min(TRAINING_PLAN_DAYS + 1, completedDay + 1);
}

/**
 * 將過期但未完成的 active plan 原封不動帶到指定日期。
 * 已完成區塊不會重開；running 轉 paused，要求使用者明確恢復。
 */
export function rolloverIncompleteTrainingPlan(
  plan: DailyTrainingPlan,
  date: string
): DailyTrainingPlan | null {
  if (plan.status === "completed" || plan.date >= date) return null;
  const firstIncomplete = plan.blocks.findIndex(
    (item) => item.status !== "completed"
  );
  if (firstIncomplete < 0) return null;
  const activeStillIncomplete =
    plan.blocks[plan.activeBlockIndex]?.status !== "completed";
  const activeBlockIndex = activeStillIncomplete
    ? plan.activeBlockIndex
    : firstIncomplete;
  return {
    ...plan,
    id: `training-${date}-day-${plan.planDay}-rollover`,
    date,
    status: "paused",
    activeBlockIndex,
    blocks: plan.blocks.map((item, index) => ({
      ...item,
      status:
        item.status === "completed"
          ? "completed"
          : index === activeBlockIndex
            ? "running"
            : "pending"
    })),
    completedAt: undefined
  };
}

export function trainingPlanForDate(
  program: TrainingProgramState,
  date: string
): DailyTrainingPlan | null {
  const activePlan = program.activePlan;
  if (!activePlan) return null;
  if (activePlan.date === date) return activePlan;
  return rolloverIncompleteTrainingPlan(activePlan, date);
}

export function trainingPhaseForDay(day: number): TrainingPlanPhase {
  if (day <= 7) return "foundation";
  if (day <= 14) return "patterns";
  if (day <= 21) return "transfer";
  return "interview";
}

export function trainingPhaseLabel(phase: TrainingPlanPhase): string {
  return {
    foundation: "第 1 階段 · 盤點與重建",
    patterns: "第 2 階段 · 題型集中訓練",
    transfer: "第 3 階段 · 陌生變形與交錯",
    interview: "第 4 階段 · 面試轉換"
  }[phase];
}

function hasPracticeHistory(record: StudyRecord | undefined): boolean {
  return Boolean(
    record &&
      (record.attempts > 0 ||
        record.passed > 0 ||
        record.failed > 0 ||
        record.fsrs ||
        record.recallCheckpointDue ||
        record.status !== "new")
  );
}

function isNewProblem(record: StudyRecord | undefined): boolean {
  return !hasPracticeHistory(record);
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function uniqueProblems(problems: ProblemSummary[]): ProblemSummary[] {
  const seen = new Set<string>();
  return problems.filter((problem) => {
    if (!problem.id || seen.has(problem.id)) return false;
    seen.add(problem.id);
    return true;
  });
}

function diverseTake(
  problems: ProblemSummary[],
  count: number,
  random: () => number
): ProblemSummary[] {
  if (count <= 0) return [];
  const byCategory = new Map<string, ProblemSummary[]>();
  for (const problem of shuffled(problems, random)) {
    const bucket = byCategory.get(problem.category) ?? [];
    bucket.push(problem);
    byCategory.set(problem.category, bucket);
  }
  const categories = shuffled([...byCategory.keys()], random);
  const selected: ProblemSummary[] = [];
  while (selected.length < count && categories.length > 0) {
    for (let index = categories.length - 1; index >= 0; index -= 1) {
      const category = categories[index];
      const bucket = byCategory.get(category) ?? [];
      const next = bucket.shift();
      if (next) selected.push(next);
      if (bucket.length === 0) categories.splice(index, 1);
      if (selected.length >= count) break;
    }
  }
  return selected;
}

function weaknessCategories(
  problems: ProblemSummary[],
  records: Record<string, StudyRecord>,
  now: Date
): string[] {
  const scores = new Map<string, number>();
  for (const problem of problems) {
    const record = records[problem.id];
    let score = scores.get(problem.category) ?? 0;
    if (record) {
      score += record.failed * 3;
      score += (record.assistedPassed ?? 0) * 2;
      score += record.status === "retry" ? 6 : 0;
      score +=
        record.attempts > 0 && independentPassCount(record) === 0 ? 4 : 0;
      score +=
        independentPassCount(record) > 0 &&
        isRecordReadyForReview(record, now)
          ? 2
          : 0;
    }
    scores.set(problem.category, score);
  }
  return [...scores.entries()]
    .sort(
      ([leftCategory, left], [rightCategory, right]) =>
        right - left || leftCategory.localeCompare(rightCategory, "zh-TW")
    )
    .map(([category]) => category);
}

function focusForDay(
  day: number,
  problems: ProblemSummary[],
  records: Record<string, StudyRecord>,
  now: Date
): string[] {
  const scheduled = DAY_FOCUS[Math.min(day, TRAINING_PLAN_DAYS) - 1] ?? [];
  const available = new Set(problems.map((problem) => problem.category));
  const explicit = scheduled.filter((category) => available.has(category));
  if (explicit.length > 0) return explicit;
  return weaknessCategories(problems, records, now).slice(0, 2);
}

function adjustedPreset(
  preset: TrainingMenuSize,
  phase: TrainingPlanPhase
): TrainingMenuPreset {
  const base = TRAINING_MENU_PRESETS[preset];
  if (phase === "transfer") {
    return {
      ...base,
      learn: Math.max(1, base.learn - 1),
      transfer: base.transfer + 1
    };
  }
  if (phase === "interview") {
    return {
      ...base,
      learn: Math.min(base.learn, preset === "intensive" ? 2 : 1),
      transfer: Math.max(1, base.transfer),
      speed: Math.min(base.speed, 1)
    };
  }
  return base;
}

function block(
  kind: TrainingBlockKind,
  targetCount: number,
  problems: ProblemSummary[]
): DailyTrainingBlock | null {
  if (problems.length === 0) return null;
  const copy = BLOCK_COPY[kind];
  const problemIds = problems.map((problem) => problem.id);
  return {
    id: `${kind}-${problemIds.join("-")}`,
    kind,
    mode: copy.mode,
    title: copy.title,
    purpose: copy.purpose,
    targetCount,
    problemIds,
    remainingProblemIds: problemIds,
    status: "pending"
  };
}

export interface BuildDailyTrainingPlanInput {
  problems: ProblemSummary[];
  records: Record<string, StudyRecord>;
  program: TrainingProgramState;
  preset?: TrainingMenuSize;
  now?: Date;
  random?: () => number;
}

export function buildDailyTrainingPlan({
  problems,
  records,
  program,
  preset = program.preset,
  now = new Date(),
  random = Math.random
}: BuildDailyTrainingPlanInput): DailyTrainingPlan | null {
  const planDay = nextTrainingDay(program, now);
  if (planDay > TRAINING_PLAN_DAYS) return null;

  const candidates = uniqueProblems(problems);
  const core = candidates.filter(
    (problem) =>
      problem.runnable &&
      problem.testCount > 0 &&
      problem.difficulty !== "hard" &&
      problem.difficulty !== "unknown" &&
      problem.sources.some((source) =>
        CORE_TRAINING_SOURCES.includes(
          source as (typeof CORE_TRAINING_SOURCES)[number]
        )
      )
  );
  const eligible =
    core.length > 0
      ? core
      : candidates.filter(
          (problem) =>
            problem.runnable &&
            problem.testCount > 0 &&
            problem.difficulty !== "hard"
        );
  if (eligible.length === 0) return null;

  const phase = trainingPhaseForDay(planDay);
  const quota = adjustedPreset(preset, phase);
  const focusCategories = focusForDay(planDay, eligible, records, now);
  const focusSet = new Set(focusCategories);
  const selectedIds = new Set<string>();
  const withoutSelected = (problem: ProblemSummary) =>
    !selectedIds.has(problem.id);
  const remember = (items: ProblemSummary[]) => {
    for (const item of items) selectedIds.add(item.id);
    return items;
  };

  const orderedReady = orderProblemsForReview(
    eligible,
    records,
    now
  ).filter(
    (problem) =>
      isRecordReadyForReview(records[problem.id], now) &&
      hasPracticeHistory(records[problem.id])
  );
  const recall = remember(diverseTake(orderedReady, quota.recall, random));

  const newProblems = shuffled(
    eligible.filter((problem) => isNewProblem(records[problem.id])),
    random
  );
  const focusedNew = newProblems.filter((problem) =>
    focusSet.has(problem.category)
  );
  const learnPool = [
    ...focusedNew,
    ...newProblems.filter((problem) => !focusSet.has(problem.category))
  ].filter(withoutSelected);
  const learn = remember(learnPool.slice(0, quota.learn));

  const transferPool = [
    ...newProblems.filter(
      (problem) =>
        focusSet.has(problem.category) && withoutSelected(problem)
    ),
    ...orderedReady.filter(
      (problem) =>
        focusSet.has(problem.category) &&
        independentPassCount(records[problem.id]) > 0 &&
        withoutSelected(problem)
    )
  ];
  const transfer = remember(
    diverseTake(transferPool, quota.transfer, random)
  );

  const speedPool = orderedReady.filter(
    (problem) =>
      independentPassCount(records[problem.id]) > 0 &&
      withoutSelected(problem)
  );
  const speed = remember(diverseTake(speedPool, quota.speed, random));

  const interviewPool =
    phase === "interview"
      ? [
          ...newProblems.filter(
            (problem) =>
              problem.difficulty === "medium" && withoutSelected(problem)
          ),
          ...orderedReady.filter(
            (problem) =>
              problem.difficulty === "medium" && withoutSelected(problem)
          )
        ]
      : [];
  const interview = remember(
    diverseTake(interviewPool, quota.interview, random)
  );

  const blocks = [
    block("recall", quota.recall, recall),
    block("learn", quota.learn, learn),
    block("transfer", quota.transfer, transfer),
    block("speed", quota.speed, speed),
    block("interview", quota.interview, interview)
  ].filter((item): item is DailyTrainingBlock => Boolean(item));

  if (blocks.length === 0) return null;

  const date = trainingDateKey(now);
  return {
    id: `training-${date}-day-${planDay}-${now.getTime()}`,
    date,
    planDay,
    phase,
    focusCategories,
    preset,
    estimatedMinutes: quota.estimatedMinutes,
    status: "ready",
    activeBlockIndex: 0,
    blocks,
    createdAt: now.toISOString()
  };
}

export function currentTrainingBlock(
  plan: DailyTrainingPlan | undefined
): DailyTrainingBlock | undefined {
  return plan?.blocks[plan.activeBlockIndex];
}

export function startTrainingBlock(
  plan: DailyTrainingPlan,
  blockIndex = plan.activeBlockIndex
): DailyTrainingPlan {
  if (plan.status === "completed" || plan.blocks.length === 0) {
    return plan;
  }
  const requestedIndex = Math.min(
    Math.max(0, blockIndex),
    Math.max(0, plan.blocks.length - 1)
  );
  const safeIndex =
    plan.blocks[requestedIndex]?.status !== "completed"
      ? requestedIndex
      : plan.blocks.findIndex((item) => item.status !== "completed");
  if (safeIndex < 0) return plan;
  return {
    ...plan,
    status: "running",
    activeBlockIndex: safeIndex,
    blocks: plan.blocks.map((item, index) =>
      index === safeIndex
        ? {
            ...item,
            status: "running",
            remainingProblemIds:
              item.remainingProblemIds.length > 0
                ? item.remainingProblemIds
                : item.problemIds
          }
        : item.status === "running"
          ? { ...item, status: "pending" }
          : item
    )
  };
}

export function pauseTrainingPlan(
  plan: DailyTrainingPlan | undefined
): DailyTrainingPlan | undefined {
  if (!plan || plan.status !== "running") return plan;
  return { ...plan, status: "paused" };
}

export type TrainingProblemOutcome =
  | "completed"
  | "skipped"
  | "left"
  | "abandoned";

export interface TrainingProblemOutcomeInput {
  mode: PracticeMode;
  /** 畫面事件發生時的題目；用來抵抗非同步切題造成的誤寫。 */
  activeProblemId: string;
  /** 只有真正通過完成時才可填，且必須等於 activeProblemId。 */
  completedProblemId?: string;
  outcome: TrainingProblemOutcome;
  occurredAt?: Date;
}

function completeActiveTrainingBlock(
  plan: DailyTrainingPlan,
  remainingProblemIds: string[],
  completedAt: Date
): DailyTrainingPlan {
  const blocks = plan.blocks.map((item, index) =>
    index === plan.activeBlockIndex
      ? {
          ...item,
          status: "completed" as const,
          remainingProblemIds
        }
      : item
  );
  const nextIndex = blocks.findIndex(
    (item) => item.status !== "completed"
  );
  if (nextIndex < 0) {
    return {
      ...plan,
      status: "completed",
      blocks,
      completedAt: completedAt.toISOString()
    };
  }
  return {
    ...plan,
    status: "ready",
    activeBlockIndex: nextIndex,
    blocks
  };
}

/**
 * Daily Training 唯一可推進進度的入口。
 *
 * - completed：必須有相符 completedProblemId，才移除並可能完成區塊。
 * - skipped／left：題目仍未完成，只移到剩餘清單尾端。
 * - abandoned：保留全部進度並暫停。
 */
export function recordTrainingProblemOutcome(
  plan: DailyTrainingPlan,
  input: TrainingProblemOutcomeInput
): DailyTrainingPlan {
  if (plan.status !== "running") return plan;
  const active = currentTrainingBlock(plan);
  if (!active || active.status !== "running" || active.mode !== input.mode) {
    return plan;
  }
  if (!active.remainingProblemIds.includes(input.activeProblemId)) {
    return plan;
  }

  if (input.outcome === "abandoned") {
    return { ...plan, status: "paused" };
  }

  if (input.outcome !== "completed") {
    const remainingProblemIds = [
      ...active.remainingProblemIds.filter(
        (id) => id !== input.activeProblemId
      ),
      input.activeProblemId
    ];
    const unchanged = active.remainingProblemIds.every(
      (id, index) => id === remainingProblemIds[index]
    );
    if (unchanged) return plan;
    return {
      ...plan,
      blocks: plan.blocks.map((item, index) =>
        index === plan.activeBlockIndex
          ? { ...item, remainingProblemIds }
          : item
      )
    };
  }

  if (input.completedProblemId !== input.activeProblemId) return plan;
  const remainingProblemIds = active.remainingProblemIds.filter(
    (id) => id !== input.completedProblemId
  );
  if (remainingProblemIds.length === 0) {
    return completeActiveTrainingBlock(
      plan,
      remainingProblemIds,
      input.occurredAt ?? new Date()
    );
  }
  return {
    ...plan,
    blocks: plan.blocks.map((item, index) =>
      index === plan.activeBlockIndex
        ? { ...item, remainingProblemIds }
        : item
    )
  };
}

export function syncTrainingPlanQueue(
  plan: DailyTrainingPlan,
  queue: string[],
  mode: PracticeMode,
  completedAt = new Date()
): DailyTrainingPlan {
  if (plan.status !== "running") return plan;
  const active = currentTrainingBlock(plan);
  if (!active || active.status !== "running" || active.mode !== mode) {
    return plan;
  }
  const allowed = new Set(active.problemIds);
  if (queue.some((id) => !allowed.has(id))) return plan;
  void completedAt;

  // Queue 是導覽快照，不是作答證據。只採用它對「仍未完成題目」的
  // 排序，缺少的 id 一律補回；空 queue 絕不能完成區塊。
  const outstanding = new Set(active.remainingProblemIds);
  const seen = new Set<string>();
  const queuedOutstanding: string[] = [];
  for (const id of queue) {
    if (!outstanding.has(id) || seen.has(id)) continue;
    seen.add(id);
    queuedOutstanding.push(id);
  }
  const remainingProblemIds = [
    ...queuedOutstanding,
    ...active.remainingProblemIds.filter((id) => !seen.has(id))
  ];
  const unchanged =
    active.remainingProblemIds.length === remainingProblemIds.length &&
    active.remainingProblemIds.every(
      (id, index) => id === remainingProblemIds[index]
    );
  if (unchanged) return plan;
  return {
    ...plan,
    blocks: plan.blocks.map((item, index) =>
      index === plan.activeBlockIndex
        ? { ...item, remainingProblemIds }
        : item
    )
  };
}

export function trainingProgramWithCompletedPlan(
  program: TrainingProgramState,
  plan: DailyTrainingPlan
): TrainingProgramState {
  if (plan.status !== "completed" || !plan.completedAt) {
    return { ...program, activePlan: plan };
  }
  const problemCount = plan.blocks.reduce(
    (total, item) => total + item.problemIds.length,
    0
  );
  return {
    ...program,
    activePlan: plan,
    completedDays: {
      ...program.completedDays,
      [plan.date]: {
        planDay: plan.planDay,
        preset: plan.preset,
        completedAt: plan.completedAt,
        completedBlocks: plan.blocks.length,
        problemCount
      }
    }
  };
}
