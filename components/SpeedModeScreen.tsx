"use client";

import {
  CheckCircle2,
  Filter,
  Play,
  RotateCcw,
  Timer,
  Trophy,
  Zap
} from "lucide-react";

import type { DifficultyFilter } from "@/lib/review";
import {
  normalizeSpeedQuestionSeconds,
  type SpeedSessionState
} from "@/lib/speedMode";
import type { StudyStatus } from "@/lib/types";

type SpeedStatusFilter = "all" | StudyStatus | "due" | "starred" | "solved";

interface SpeedModeScreenProps {
  phase: "setup" | "finished";
  candidateCount: number;
  category: string;
  source: string;
  difficulty: DifficultyFilter;
  status: SpeedStatusFilter;
  categories: string[];
  sources: string[];
  sessionSize: number;
  speedAnswerVisible: boolean;
  speedQuestionSeconds: number;
  speed: SpeedSessionState;
  acceptedTotal: number;
  onCategoryChange: (value: string) => void;
  onSourceChange: (value: string) => void;
  onDifficultyChange: (value: DifficultyFilter) => void;
  onStatusChange: (value: SpeedStatusFilter) => void;
  onSessionSizeChange: (value: number) => void;
  onSpeedAnswerVisibleChange: (value: boolean) => void;
  onSpeedQuestionSecondsChange: (value: number) => void;
  onStart: () => void;
  onNewSetup: () => void;
}

function difficultyOptions() {
  return [
    ["all", "全部難度"],
    ["easy", "只有簡單"],
    ["medium", "只有中等"],
    ["hard", "只有困難"],
    ["easy-medium", "簡單＋中等"],
    ["medium-hard", "中等＋困難"]
  ] as const;
}

export default function SpeedModeScreen({
  phase,
  candidateCount,
  category,
  source,
  difficulty,
  status,
  categories,
  sources,
  sessionSize,
  speedAnswerVisible,
  speedQuestionSeconds,
  speed,
  acceptedTotal,
  onCategoryChange,
  onSourceChange,
  onDifficultyChange,
  onStatusChange,
  onSessionSizeChange,
  onSpeedAnswerVisibleChange,
  onSpeedQuestionSecondsChange,
  onStart,
  onNewSetup
}: SpeedModeScreenProps) {
  const roundSeconds = Math.round(speed.questionLimitMs / 1000);

  if (phase === "finished") {
    const categoryRows = Object.entries(speed.categories).sort(
      ([left], [right]) => left.localeCompare(right, "zh-Hant")
    );
    const accuracy = speed.total
      ? Math.round((speed.solved / speed.total) * 100)
      : 0;

    return (
      <section className="speed-mode-screen speed-mode-summary">
        <div className="speed-mode-mark completed">
          <Trophy size={30} />
        </div>
        <p className="section-kicker">SPEED MODE · ROUND COMPLETE</p>
        <h1>這輪衝刺完成</h1>
        <p className="speed-mode-lead">
          分數只算 {roundSeconds} 秒內的無提示 AC；逾時只記一次忘記，答案重打不會再次改動 FSRS。
        </p>

        <div className="speed-summary-grid">
          <span>
            <small>總分</small>
            <strong>{speed.score.toLocaleString("zh-TW")}</strong>
          </span>
          <span>
            <small>完成 AC</small>
            <strong>{acceptedTotal}/{speed.total}</strong>
          </span>
          <span>
            <small>限時 AC</small>
            <strong>{speed.solved}</strong>
          </span>
          <span>
            <small>超時重打</small>
            <strong>{speed.timedOut}</strong>
          </span>
          <span>
            <small>限時正確率</small>
            <strong>{accuracy}%</strong>
          </span>
        </div>

        <section className="speed-category-summary">
          <header>
            <strong>題型表現</strong>
            <span>用這裡找下一輪要單刷的分類</span>
          </header>
          {categoryRows.length ? (
            <div>
              {categoryRows.map(([name, stats]) => (
                <article key={name}>
                  <strong>{name}</strong>
                  <span>限時 AC {stats.solved}</span>
                  <span>超時 {stats.timedOut}</span>
                  <span>錯誤送出 {stats.wrongAttempts}</span>
                  <em>{stats.points.toLocaleString("zh-TW")} 分</em>
                </article>
              ))}
            </div>
          ) : (
            <p>這輪尚未完成任何送出。</p>
          )}
        </section>

        <div className="speed-mode-actions">
          <button className="secondary" onClick={onNewSetup}>
            <Filter size={16} /> 調整下一輪題組
          </button>
          <button className="primary" disabled={!candidateCount} onClick={onStart}>
            <RotateCcw size={16} /> 再來一輪
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="speed-mode-screen speed-mode-setup">
      <div className="speed-mode-mark">
        <Zap size={30} />
      </div>
      <p className="section-kicker">SPEED MODE · TIMED RECALL</p>
      <h1>每題 {speedQuestionSeconds} 秒，限時重建</h1>
      <p className="speed-mode-lead">
        時間內 AC 才計分；超時後會顯示完整答案，必須重打並送出才能離開這一題。
      </p>

      <div className="speed-rule-row" aria-label="Speed Mode 規則">
        <span><Timer size={15} /> 每題 {speedQuestionSeconds} 秒</span>
        <span><CheckCircle2 size={15} /> AC 才拿分</span>
        <span><Trophy size={15} /> 剩餘時間加分</span>
      </div>

      <div className="speed-setup-filters">
        <label>
          <span>題型</span>
          <select value={category} onChange={(event) => onCategoryChange(event.currentTarget.value)}>
            <option value="all">全部題型</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>題單</span>
          <select value={source} onChange={(event) => onSourceChange(event.currentTarget.value)}>
            <option value="all">全部題單</option>
            {sources.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>難度</span>
          <select value={difficulty} onChange={(event) => onDifficultyChange(event.currentTarget.value as DifficultyFilter)}>
            {difficultyOptions().map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>題數</span>
          <select value={sessionSize} onChange={(event) => onSessionSizeChange(Number(event.currentTarget.value))}>
            <option value={5}>5 題</option>
            <option value={10}>10 題</option>
            <option value={20}>20 題</option>
            <option value={30}>30 題</option>
            <option value={0}>全部</option>
          </select>
        </label>
        <label>
          <span>每題秒數（10～600）</span>
          <input
            type="number"
            min={10}
            max={600}
            step={5}
            value={speedQuestionSeconds}
            onChange={(event) =>
              onSpeedQuestionSecondsChange(
                normalizeSpeedQuestionSeconds(event.currentTarget.value)
              )
            }
          />
        </label>
        <label>
          <span>進度</span>
          <select value={status} onChange={(event) => onStatusChange(event.currentTarget.value as SpeedStatusFilter)}>
            <option value="all">全部狀態</option>
            <option value="due">今天到期</option>
            <option value="solved">已解決（曾 AC）</option>
            <option value="new">未開始</option>
            <option value="learning">嘗試中</option>
            <option value="retry">需要重刷</option>
            <option value="completed">已完成</option>
            <option value="mastered">已掌握</option>
            <option value="starred">已收藏</option>
          </select>
        </label>
        <label>
          <span>解答</span>
          <select
            value={speedAnswerVisible ? "visible" : "hidden"}
            onChange={(event) =>
              onSpeedAnswerVisibleChange(
                event.currentTarget.value === "visible"
              )
            }
          >
            <option value="hidden">限時隱藏（挑戰）</option>
            <option value="visible">預設開啟（跟打）</option>
          </select>
        </label>
      </div>

      <div className="speed-pool-note">
        <span><Zap size={15} /> 目前可用 {candidateCount} 題</span>
        <small>
          {speedAnswerVisible
            ? "跟打只保留練習提交，不計分，也不影響 FSRS。"
            : "FSRS 先排已到期題，再補入目前題組。"}
        </small>
      </div>

      <div className="speed-mode-actions">
        <button className="primary" disabled={!candidateCount} onClick={onStart}>
          <Play size={16} /> 開始 {speedQuestionSeconds} 秒挑戰
        </button>
      </div>
    </section>
  );
}
