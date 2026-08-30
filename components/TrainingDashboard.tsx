"use client";

import { CalendarDays, ChevronDown, Gauge, TimerReset } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { submissionIntensity } from "@/lib/activity";
import type { DailyProgress } from "@/lib/dailyProgress";
import {
  buildRecallCalibration,
  recallCalibrationLabel
} from "@/lib/memoryCalibration";
import { independentPassCount } from "@/lib/review";
import { localDateKey } from "@/lib/storage";
import type {
  DailyActivity,
  Difficulty,
  ProblemSummary,
  SubmissionEvent,
  StudyRecord
} from "@/lib/types";

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "簡單",
  medium: "中等",
  hard: "困難",
  unknown: "未標示"
};

interface SessionSnapshot {
  attempted: number;
  passed: number;
  failed: number;
  skipped: number;
  totalMs: number;
}

interface TrainingDashboardProps {
  open: boolean;
  onToggle: () => void;
  problems: ProblemSummary[];
  records: Record<string, StudyRecord>;
  activity: Record<string, DailyActivity>;
  submissionHistory: SubmissionEvent[];
  session: SessionSnapshot;
  sessionGoal: number;
  queueRemaining: number;
  sessionElapsedSeconds: number;
  dueCount: number;
  now: number;
  dailyProgress: DailyProgress;
}

interface RingProps {
  value: number;
  total: number;
  label: string;
  tone: string;
  compact?: boolean;
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function formatDuration(milliseconds: number): string {
  if (!milliseconds) return "—";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatSubmissionTime(value: string): string {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfDay(value: Date | number): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function currentStreak(
  activity: Record<string, DailyActivity>,
  now: number
): number {
  let cursor = startOfDay(now);
  if (!(activity[localDateKey(cursor)]?.submissions > 0)) {
    cursor = addDays(cursor, -1);
  }
  if (!(activity[localDateKey(cursor)]?.submissions > 0)) return 0;

  let streak = 0;
  while (activity[localDateKey(cursor)]?.submissions > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function ProgressRing({ value, total, label, tone, compact = false }: RingProps) {
  const ratio = total > 0 ? Math.min(1, value / total) : 0;
  const radius = compact ? 27 : 48;
  const circumference = 2 * Math.PI * radius;
  const size = compact ? 68 : 118;
  const strokeWidth = compact ? 5 : 8;

  return (
    <div className={`progress-ring ${compact ? "compact" : ""} ${tone}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <circle
          className="ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference * ratio} ${circumference}`}
        />
      </svg>
      <div className="ring-copy">
        <strong>
          {value}
          <small>/{total}</small>
        </strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

export default function TrainingDashboard({
  open,
  onToggle,
  problems,
  records,
  activity,
  submissionHistory,
  session,
  sessionGoal,
  queueRemaining,
  sessionElapsedSeconds,
  dueCount,
  now,
  dailyProgress
}: TrainingDashboardProps) {
  const heatmapScrollRef = useRef<HTMLDivElement>(null);
  const statistics = useMemo(() => {
    const difficulty = {
      easy: { solved: 0, total: 0 },
      medium: { solved: 0, total: 0 },
      hard: { solved: 0, total: 0 },
      unknown: { solved: 0, total: 0 }
    };
    let solved = 0;
    let attemptedProblems = 0;
    let mastered = 0;
    let submissions = 0;
    let passed = 0;
    let failed = 0;
    let totalMs = 0;
    let memoryPassed = 0;
    let assistedPassed = 0;

    for (const problem of problems) {
      const record = records[problem.id];
      const independentPasses = independentPassCount(record);
      const wasSolved = independentPasses > 0;
      difficulty[problem.difficulty].total += 1;
      if (wasSolved) difficulty[problem.difficulty].solved += 1;
      if (wasSolved) solved += 1;
      if ((record?.attempts ?? 0) > 0) attemptedProblems += 1;
      if (record?.status === "mastered") mastered += 1;
      submissions += record?.attempts ?? 0;
      passed += record?.passed ?? 0;
      memoryPassed += independentPasses;
      assistedPassed += record?.assistedPassed ?? 0;
      failed += record?.failed ?? 0;
      totalMs += record?.totalMs ?? 0;
    }

    return {
      difficulty,
      solved,
      attemptedProblems,
      mastered,
      submissions,
      passed,
      memoryPassed,
      assistedPassed,
      failed,
      totalMs
    };
  }, [problems, records]);
  const calibration = useMemo(
    () => buildRecallCalibration(submissionHistory),
    [submissionHistory]
  );

  const calendar = useMemo(() => {
    const today = startOfDay(now);
    const calendarEnd = addDays(today, 6 - today.getDay());
    const calendarStart = addDays(calendarEnd, -(53 * 7 - 1));
    const days = Array.from({ length: 53 * 7 }, (_, index) => {
      const date = addDays(calendarStart, index);
      const key = localDateKey(date);
      const submissions = activity[key]?.submissions ?? 0;
      return {
        date,
        key,
        submissions,
        future: date > today,
        level: submissionIntensity(submissions)
      };
    });

    const monthLabels: Array<{ week: number; label: string }> = [];
    let previousMonth = -1;
    for (let week = 0; week < 53; week += 1) {
      const date = addDays(calendarStart, week * 7);
      if (date.getMonth() !== previousMonth) {
        monthLabels.push({
          week,
          label: `${date.getMonth() + 1}月`
        });
        previousMonth = date.getMonth();
      }
    }

    const yearStart = addDays(today, -364);
    const pastYear = days.filter(
      (day) => day.date >= yearStart && day.date <= today
    );
    const yearSubmissions = pastYear.reduce(
      (total, day) => total + day.submissions,
      0
    );
    const activeDays = Object.values(activity).filter(
      (day) => day.submissions > 0
    ).length;

    return {
      days,
      monthLabels,
      yearSubmissions,
      activeDays,
      streak: currentStreak(activity, now)
    };
  }, [activity, now]);

  const problemById = useMemo(
    () => new Map(problems.map((problem) => [problem.id, problem])),
    [problems]
  );
  const dailyHistory = useMemo(
    () =>
      Object.entries(activity)
        .filter(([, day]) => day.submissions > 0)
        .sort(([first], [second]) => second.localeCompare(first))
        .slice(0, 14),
    [activity]
  );

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const element = heatmapScrollRef.current;
      if (!element) return;
      element.scrollLeft = element.scrollWidth - element.clientWidth;
    });
    return () => cancelAnimationFrame(frame);
  }, [activity, open]);

  // Queue 只代表目前導覽位置；跳過／下一題不等於完成。
  const sessionCompleted = Math.min(sessionGoal, Math.max(0, session.passed));
  const sessionProgress = percent(sessionCompleted, sessionGoal);
  const passRate = percent(statistics.passed, statistics.submissions);
  const solveRate = percent(statistics.solved, statistics.attemptedProblems);
  const masteredRate = percent(statistics.mastered, statistics.solved);
  const currentSpeed =
    sessionElapsedSeconds > 0
      ? (session.attempted / sessionElapsedSeconds) * 3600
      : 0;
  const averageMs = statistics.submissions
    ? statistics.totalMs / statistics.submissions
    : 0;

  return (
    <section className={`training-dashboard ${open ? "open" : ""}`}>
      <button className="training-dashboard-trigger" onClick={onToggle}>
        <span>
          <Gauge size={16} />
          <strong>訓練儀表板</strong>
          <em>
            {statistics.solved}/{problems.length} 已解答 · 過去一年{" "}
            {calendar.yearSubmissions} 次提交
          </em>
        </span>
        <ChevronDown size={17} className={open ? "rotated" : ""} />
      </button>

      {open && (
        <div className="training-dashboard-body">
          <section className="daily-recall-summary" aria-label="今日學習成果">
            <header>
              <CalendarDays size={16} />
              <strong>今日唯一題目</strong>
              <span>{dailyProgress.dateKey}</span>
            </header>
            <div>
              <span>
                <strong>{dailyProgress.touchedProblemIds.size}</strong>
                接觸題目
              </span>
              <span>
                <strong>{dailyProgress.independentCompletedProblemIds.size}</strong>
                獨立 AC
              </span>
              <span>
                <strong>{dailyProgress.assistedCompletedProblemIds.size}</strong>
                輔助完成
              </span>
              <span>
                <strong>{dailyProgress.unfinishedProblemIds.size}</strong>
                未完成
              </span>
              <span>
                <strong>{dailyProgress.submissions}</strong>
                實際送出
              </span>
              <span>
                <strong>{dailyProgress.fsrsWrites}</strong>
                FSRS 更新
              </span>
            </div>
          </section>
          <div className="training-summary">
            <div className="overall-ring">
              <ProgressRing
                value={statistics.solved}
                total={problems.length}
                label="已解答"
                tone="overall"
              />
              <strong>{percent(statistics.solved, problems.length)}%</strong>
              <span>題庫完成率</span>
            </div>

            <div className="training-metrics">
              <div>
                <span>測資通過率</span>
                <strong>{passRate}%</strong>
                <small>
                  {statistics.passed}/{statistics.submissions} 次提交
                </small>
              </div>
              <div>
                <span>解題成功率</span>
                <strong>{solveRate}%</strong>
                <small>至少一次獨立 AC</small>
              </div>
              <div>
                <span>已掌握</span>
                <strong>{masteredRate}%</strong>
                <small>{statistics.mastered} 題完成 FSRS</small>
              </div>
              <div>
                <span>平均解題時間</span>
                <strong>{formatDuration(averageMs)}</strong>
                <small>從讀題到送出</small>
              </div>
              <div>
                <span>目前時速</span>
                <strong>{currentSpeed.toFixed(1)}</strong>
                <small>本輪提交／小時</small>
              </div>
              <div>
                <span>待複習</span>
                <strong>{dueCount}</strong>
                <small>到期、新題與延遲驗收</small>
              </div>
              <div>
                <span>記憶模型校準</span>
                <strong>{recallCalibrationLabel(calibration)}</strong>
                <small>
                  {calibration.sampleSize
                    ? `預估 ${Math.round(calibration.predictedRecall * 100)}%／實際 ${Math.round(calibration.observedRecall * 100)}% · ${calibration.sampleSize} 筆`
                    : "完成有既有 FSRS 的無提示提交後開始計算"}
                </small>
              </div>
            </div>
          </div>

          <div className="session-meter">
            <div>
              <TimerReset size={15} />
              <span>本輪</span>
              <strong>
                {sessionCompleted}/{sessionGoal || queueRemaining}
              </strong>
            </div>
            <div className="session-meter-track">
              <span style={{ width: `${sessionProgress}%` }} />
            </div>
            <em>{sessionProgress}%</em>
          </div>

          <div className="difficulty-rings">
            {(
              ["easy", "medium", "hard", "unknown"] as const
            ).map((difficulty) => (
              <div className="difficulty-ring-card" key={difficulty}>
                <ProgressRing
                  compact
                  value={statistics.difficulty[difficulty].solved}
                  total={statistics.difficulty[difficulty].total}
                  label={DIFFICULTY_LABEL[difficulty]}
                  tone={difficulty}
                />
                <span>
                  {statistics.difficulty[difficulty].solved} 已解答
                </span>
              </div>
            ))}
          </div>

          <div className="submission-summary">
            <span>
              <strong>{statistics.submissions}</strong> 累積提交
            </span>
            <span>
              <strong>{statistics.failed}</strong> 錯誤
            </span>
            <span>
              <strong>{statistics.memoryPassed}</strong> 獨立 AC
            </span>
            <span>
              <strong>{statistics.assistedPassed}</strong> 輔助 AC
            </span>
            <span>
              <strong>{statistics.attemptedProblems}</strong> 題嘗試中
            </span>
          </div>

          <section className="activity-calendar">
            <div className="activity-heading">
              <div>
                <CalendarDays size={16} />
                <strong>過去一年共提交 {calendar.yearSubmissions} 次</strong>
              </div>
              <div>
                <span>累積提交天數：{calendar.activeDays}</span>
                <span>連續提交：{calendar.streak}</span>
              </div>
            </div>

            <div className="heatmap-scroll" ref={heatmapScrollRef}>
              <div className="heatmap-content">
                <div className="heatmap-months">
                  {calendar.monthLabels.map((month) => (
                    <span
                      key={`${month.week}-${month.label}`}
                      style={{ gridColumnStart: month.week + 1 }}
                    >
                      {month.label}
                    </span>
                  ))}
                </div>
                <div className="heatmap-row">
                  <div className="heatmap-weekdays" aria-hidden="true">
                    <span>一</span>
                    <span>三</span>
                    <span>五</span>
                  </div>
                  <div className="heatmap-grid" aria-label="每日提交紀錄">
                    {calendar.days.map((day) => (
                      <span
                        key={day.key}
                        className={`heat-cell level-${day.level} ${
                          day.future ? "future" : ""
                        }`}
                        title={`${day.key}：${day.submissions} 次提交`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="heatmap-legend">
              <span>少</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <i className={`heat-cell level-${level}`} key={level} />
              ))}
              <span>多</span>
            </div>
          </section>

          <section className="submission-history">
            <header>
              <div>
                <strong>歷史提交紀錄</strong>
                <span>每日彙總保留既有資料；逐筆紀錄從現在開始保存</span>
              </div>
            </header>

            <div className="daily-submission-list">
              {dailyHistory.length ? (
                dailyHistory.map(([date, day]) => (
                  <div key={date}>
                    <time>{date}</time>
                    <span>{day.submissions} 次送出</span>
                    <span className="passed">{day.passed} AC</span>
                    <span className="failed">{day.failed} 錯誤</span>
                    <span>{formatDuration(day.totalMs)}</span>
                  </div>
                ))
              ) : (
                <p>尚無提交紀錄。</p>
              )}
            </div>

            <div className="submission-event-list">
              <div className="submission-event-heading">
                <strong>最近逐筆紀錄</strong>
                <span>{submissionHistory.length} 筆</span>
              </div>
              {submissionHistory.length ? (
                submissionHistory.slice(0, 20).map((event) => {
                  const submittedProblem = problemById.get(event.problemId);
                  return (
                    <div className="submission-event" key={event.id}>
                      <span
                        className={`submission-result ${
                          event.passed ? "passed" : "failed"
                        }`}
                      >
                        {event.passed ? "AC" : "錯誤"}
                      </span>
                      <div>
                        <strong>
                          {submittedProblem?.identity ?? event.problemId}{" "}
                          {submittedProblem?.title ?? ""}
                        </strong>
                        <span>
                          {formatSubmissionTime(event.submittedAt)} ·{" "}
                          {formatDuration(event.durationMs)}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="submission-history-empty">
                  舊資料只保存每日總數；下一次送出後會開始列出題目與時間。
                </p>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
