"use client";

import {
  BookOpen,
  BrainCircuit,
  Check,
  Clock3,
  Compass,
  Flame,
  Play,
  RotateCcw,
  TimerReset,
  X,
  Zap
} from "lucide-react";
import { useEffect } from "react";

import {
  TRAINING_MENU_PRESETS,
  TRAINING_PLAN_DAYS,
  currentTrainingBlock,
  trainingPhaseLabel
} from "@/lib/trainingPlan";
import type {
  DailyTrainingBlock,
  DailyTrainingPlan,
  TrainingBlockKind,
  TrainingMenuSize,
  TrainingProgramState
} from "@/lib/types";

const BLOCK_ICON: Record<TrainingBlockKind, typeof BookOpen> = {
  recall: BrainCircuit,
  learn: BookOpen,
  transfer: Compass,
  speed: Zap,
  interview: Flame
};

interface DailyTrainingMenuProps {
  open: boolean;
  program: TrainingProgramState;
  displayPlan: DailyTrainingPlan | null;
  isPreview: boolean;
  todayCompleted: boolean;
  disabled?: boolean;
  onClose: () => void;
  onPresetChange: (preset: TrainingMenuSize) => void;
  onPrimaryAction: () => void;
  onPause: () => void;
  onRebuild: () => void;
}

function blockStatusLabel(
  block: DailyTrainingBlock,
  active: boolean,
  preview: boolean
): string {
  if (preview) return `${block.problemIds.length} 題`;
  if (block.status === "completed") return "已完成";
  if (active && block.status === "running") {
    return `進行中 · ${block.remainingProblemIds.length} 題`;
  }
  return `${block.remainingProblemIds.length || block.problemIds.length} 題`;
}

function primaryLabel(
  plan: DailyTrainingPlan | null,
  preview: boolean,
  todayCompleted: boolean
): string {
  if (todayCompleted) return "今日菜單已完成";
  if (!plan || preview) return "開始今日特訓";
  if (plan.status === "running") return "回到目前訓練";
  if (plan.status === "paused") return "繼續未完成區塊";
  return plan.blocks.some((block) => block.status === "completed")
    ? "開始下一個區塊"
    : "開始今日特訓";
}

export default function DailyTrainingMenu({
  open,
  program,
  displayPlan,
  isPreview,
  todayCompleted,
  disabled = false,
  onClose,
  onPresetChange,
  onPrimaryAction,
  onPause,
  onRebuild
}: DailyTrainingMenuProps) {
  useEffect(() => {
    if (!open) return;
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [onClose, open]);

  if (!open) return null;

  const completedDays = new Set(
    Object.values(program.completedDays).map((day) => day.planDay)
  ).size;
  const monthProgress = Math.round(
    (Math.min(TRAINING_PLAN_DAYS, completedDays) / TRAINING_PLAN_DAYS) * 100
  );
  const activeBlock = currentTrainingBlock(displayPlan ?? undefined);
  const completedBlocks =
    displayPlan?.blocks.filter((block) => block.status === "completed")
      .length ?? 0;
  const blockProgress = displayPlan?.blocks.length
    ? Math.round((completedBlocks / displayPlan.blocks.length) * 100)
    : 0;
  const presetLocked =
    Boolean(program.activePlan) &&
    program.activePlan?.status !== "completed";

  return (
    <div
      className="daily-training-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="daily-training-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-training-title"
      >
        <header className="daily-training-heading">
          <div>
            <span className="daily-training-kicker">
              <BrainCircuit size={15} />
              30 日特訓菜單
            </span>
            <h2 id="daily-training-title">
              {displayPlan
                ? `Day ${displayPlan.planDay} · ${trainingPhaseLabel(displayPlan.phase)}`
                : "30 日訓練已完成"}
            </h2>
            <p>
              菜單只負責安排順序；只有無提示、可驗證的 AC 才能更新
              FSRS。
            </p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="關閉今日特訓"
          >
            <X size={18} />
          </button>
        </header>

        <div className="training-month-progress">
          <div>
            <span>整月進度</span>
            <strong>
              {completedDays}/{TRAINING_PLAN_DAYS} 天
            </strong>
          </div>
          <div className="training-plan-track">
            <span style={{ width: `${monthProgress}%` }} />
          </div>
          <em>{monthProgress}%</em>
        </div>

        <div className="training-preset-group" aria-label="今日訓練份量">
          {(Object.keys(TRAINING_MENU_PRESETS) as TrainingMenuSize[]).map(
            (preset) => {
              const item = TRAINING_MENU_PRESETS[preset];
              return (
                <button
                  key={preset}
                  className={program.preset === preset ? "active" : ""}
                  disabled={disabled || presetLocked}
                  onClick={() => onPresetChange(preset)}
                >
                  <strong>{item.label}</strong>
                  <span>
                    約 {item.estimatedMinutes >= 60
                      ? `${item.estimatedMinutes / 60} 小時`
                      : `${item.estimatedMinutes} 分鐘`}
                  </span>
                </button>
              );
            }
          )}
        </div>

        {displayPlan ? (
          <>
            <div className="training-plan-summary">
              <div>
                <span>今日主題</span>
                <strong>
                  {displayPlan.focusCategories.length
                    ? displayPlan.focusCategories.join("＋")
                    : "依弱點動態安排"}
                </strong>
              </div>
              <div>
                <span>預估時間</span>
                <strong>
                  <Clock3 size={14} />
                  {displayPlan.estimatedMinutes >= 60
                    ? `${displayPlan.estimatedMinutes / 60} 小時`
                    : `${displayPlan.estimatedMinutes} 分鐘`}
                </strong>
              </div>
              <div>
                <span>今日區塊</span>
                <strong>
                  {completedBlocks}/{displayPlan.blocks.length}
                </strong>
              </div>
            </div>

            <div className="daily-training-blocks">
              {displayPlan.blocks.map((block, index) => {
                const Icon = BLOCK_ICON[block.kind];
                const active = activeBlock?.id === block.id;
                return (
                  <article
                    className={[
                      "daily-training-block",
                      active ? "active" : "",
                      block.status === "completed" ? "completed" : ""
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={block.id}
                  >
                    <div className="training-block-order">
                      {block.status === "completed" ? (
                        <Check size={15} />
                      ) : (
                        index + 1
                      )}
                    </div>
                    <Icon size={18} />
                    <div>
                      <strong>{block.title}</strong>
                      <p>{block.purpose}</p>
                    </div>
                    <span>
                      {blockStatusLabel(block, active, isPreview)}
                    </span>
                  </article>
                );
              })}
            </div>

            <div className="training-block-progress">
              <span style={{ width: `${blockProgress}%` }} />
            </div>

            <div className="training-evidence-note">
              <TimerReset size={16} />
              <div>
                <strong>訓練效果閘門</strong>
                <span>
                  Repeat、答案開啟、逾時重打只保留練習紀錄；隔開後的
                  0% 提示重建才會推進記憶。
                </span>
              </div>
            </div>

            <footer className="daily-training-actions">
              <div>
                {!isPreview && displayPlan.status === "running" && (
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={onPause}
                    >
                      <RotateCcw size={15} />
                      暫停菜單
                    </button>
                  )}
                {!isPreview &&
                  displayPlan.status !== "running" &&
                  displayPlan.status !== "completed" && (
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={onRebuild}
                    >
                      重新產生
                    </button>
                  )}
              </div>
              <button
                className="primary"
                disabled={disabled || todayCompleted}
                onClick={onPrimaryAction}
              >
                {displayPlan.status === "running" ? (
                  <BookOpen size={16} />
                ) : (
                  <Play size={16} />
                )}
                {primaryLabel(displayPlan, isPreview, todayCompleted)}
              </button>
            </footer>
          </>
        ) : (
          <div className="training-plan-finished">
            <Check size={34} />
            <h3>30 個訓練日已完成</h3>
            <p>後續回到引導模式，繼續處理 FSRS 到期題即可。</p>
          </div>
        )}
      </section>
    </div>
  );
}
