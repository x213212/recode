"use client";

import {
  AlertTriangle,
  ChevronDown,
  CircleAlert
} from "lucide-react";
import { useMemo } from "react";

import { buildErrorOverview } from "@/lib/errorAnalytics";
import type {
  ProblemSummary,
  SubmissionEvent
} from "@/lib/types";

interface ErrorOverviewProps {
  open: boolean;
  onToggle: () => void;
  problems: ProblemSummary[];
  submissionHistory: SubmissionEvent[];
}

export default function ErrorOverview({
  open,
  onToggle,
  problems,
  submissionHistory
}: ErrorOverviewProps) {
  const categories = useMemo(
    () => buildErrorOverview(submissionHistory, problems),
    [problems, submissionHistory]
  );
  const totalErrors = categories.reduce(
    (sum, category) => sum + category.count,
    0
  );
  const topCategory = categories[0];

  return (
    <section className={`error-overview ${open ? "open" : ""}`}>
      <button className="sidebar-section-trigger" onClick={onToggle}>
        <span>
          <CircleAlert size={16} />
          <strong>錯誤一覽</strong>
          <em>
            {totalErrors
              ? `${totalErrors} 次 · 最常 ${topCategory?.label ?? "未分類"}`
              : "尚無錯誤紀錄"}
          </em>
        </span>
        <ChevronDown size={17} className={open ? "rotated" : ""} />
      </button>

      {open && (
        <div className="error-overview-content">
          {categories.length ? (
            categories.map((category) => (
              <article className="error-category-card" key={category.id}>
                <header>
                  <span>
                    <AlertTriangle size={14} />
                    <strong>{category.label}</strong>
                  </span>
                  <b>{category.count} 次</b>
                </header>
                <div
                  className="error-category-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={category.percentage}
                >
                  <span style={{ width: `${category.percentage}%` }} />
                </div>
                <p>{category.explanation}</p>
                {category.latestReason && (
                  <code title={category.latestReason}>
                    最近：{category.latestReason}
                  </code>
                )}
                {category.topProblems.length > 0 && (
                  <div className="error-problem-list">
                    {category.topProblems.map((problem) => (
                      <span key={problem.id}>
                        <b>{problem.identity}</b>
                        <em>{problem.title}</em>
                        <small>{problem.count}</small>
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))
          ) : (
            <p className="error-overview-empty">
              送出錯誤後，系統會依 traceback 自動歸類；不需要手動標記。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
