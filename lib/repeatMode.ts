export const REPEAT_REVEAL_LEVELS = [100, 75, 50] as const;
export const REPEAT_CHECKPOINT_DELAY_MS = 30 * 60 * 1000;
// 同一階段連續失敗達 3 次就放行前進，避免整場 Repeat 無限卡在同一題。
export const REPEAT_MAX_STAGE_FAILURES = 3;

export interface RepeatSessionState {
  phase: "idle" | "running" | "finished";
  /** 0, 1, 2 分別是 100%、75%、50% 提示。 */
  stage: number;
  total: number;
  completed: number;
  failedStages: number;
  /** 目前階段的連續失敗次數；換階段或換題時歸零。舊存檔可能沒有此欄位。 */
  stageFailures?: number;
}

export interface RepeatSubmissionTransition {
  session: RepeatSessionState;
  advanceProblem: boolean;
  resetEditor: boolean;
  /** false 代表該階段未通過（含失敗滿 3 次被強制放行的情況）。 */
  stagePassed: boolean;
}

export function emptyRepeatSession(): RepeatSessionState {
  return {
    phase: "idle",
    stage: 0,
    total: 0,
    completed: 0,
    failedStages: 0,
    stageFailures: 0
  };
}

export function normalizeRepeatSession(
  value: unknown
): RepeatSessionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyRepeatSession();
  }
  const input = value as Partial<RepeatSessionState>;
  return {
    phase:
      input.phase === "running" || input.phase === "finished"
        ? input.phase
        : "idle",
    stage: Math.min(
      REPEAT_REVEAL_LEVELS.length - 1,
      Math.max(0, Math.floor(Number(input.stage) || 0))
    ),
    total: Math.max(0, Math.floor(Number(input.total) || 0)),
    completed: Math.max(
      0,
      Math.floor(Number(input.completed) || 0)
    ),
    failedStages: Math.max(
      0,
      Math.floor(Number(input.failedStages) || 0)
    ),
    // 舊存檔沒有這個欄位時安全補 0，不影響既有回合還原。
    stageFailures: Math.max(
      0,
      Math.floor(Number(input.stageFailures) || 0)
    )
  };
}

export function repeatRevealPercent(stage: number): number {
  const safeStage = Math.min(
    REPEAT_REVEAL_LEVELS.length - 1,
    Math.max(0, Math.floor(stage))
  );
  return REPEAT_REVEAL_LEVELS[safeStage];
}

export function isFinalRepeatStage(stage: number): boolean {
  return stage >= REPEAT_REVEAL_LEVELS.length - 1;
}

export function nextRepeatStage(stage: number): number {
  return Math.min(stage + 1, REPEAT_REVEAL_LEVELS.length - 1);
}

export function repeatSubmissionTransition(
  current: RepeatSessionState,
  passed: boolean
): RepeatSubmissionTransition {
  if (!passed) {
    const stageFailures =
      Math.max(0, current.stageFailures || 0) + 1;

    // 同一階段失敗達 3 次：標記該階段未通過並強制前進下一題，
    // 避免 Repeat 回合被一題卡死；failedStages 仍照實累計。
    if (stageFailures >= REPEAT_MAX_STAGE_FAILURES) {
      return {
        session: {
          ...current,
          stage: 0,
          stageFailures: 0,
          completed: current.completed + 1,
          failedStages: current.failedStages + 1
        },
        advanceProblem: true,
        resetEditor: true,
        stagePassed: false
      };
    }

    return {
      session: {
        ...current,
        failedStages: current.failedStages + 1,
        stageFailures
      },
      advanceProblem: false,
      resetEditor: false,
      stagePassed: false
    };
  }

  if (isFinalRepeatStage(current.stage)) {
    return {
      session: {
        ...current,
        stage: 0,
        stageFailures: 0,
        completed: current.completed + 1
      },
      advanceProblem: true,
      resetEditor: true,
      stagePassed: true
    };
  }

  return {
    session: {
      ...current,
      stage: nextRepeatStage(current.stage),
      // 通過後進入新階段，失敗計數重新起算。
      stageFailures: 0
    },
    advanceProblem: false,
    resetEditor: true,
    stagePassed: true
  };
}

/**
 * 100% → 75% → 50% 都是同一回合的引導重建，不能冒充獨立記憶。
 * 完成後另外安排 30 分鐘後的 0% 提示驗收；那一次要回到 Guided／
 * Speed 等無答案模式作答，通過後才有資格更新 FSRS。
 */
export function repeatCheckpointDue(
  completedAt = new Date()
): string {
  return new Date(
    completedAt.getTime() + REPEAT_CHECKPOINT_DELAY_MS
  ).toISOString();
}

export function isRepeatCheckpointDue(
  due: string | undefined,
  now = new Date()
): boolean {
  if (!due) return false;
  const dueAt = Date.parse(due);
  return Number.isFinite(dueAt) && dueAt <= now.getTime();
}
