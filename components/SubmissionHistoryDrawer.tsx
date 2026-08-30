"use client";

import { ChevronDown, History } from "lucide-react";
import { useEffect, useState } from "react";

import {
  failureReason,
  firstFailedResult
} from "@/lib/testResultSummary";
import { isMemoryEligibleSubmission } from "@/lib/memoryEvidence";
import type { SubmissionEvent } from "@/lib/types";

interface SubmissionHistoryDrawerProps {
  attempts: number;
  open: boolean;
  submissions: SubmissionEvent[];
  onToggle: () => void;
}

function durationLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function submittedAtLabel(value: string) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

export default function SubmissionHistoryDrawer({
  attempts,
  open,
  submissions,
  onToggle
}: SubmissionHistoryDrawerProps) {
  const [openSubmissionId, setOpenSubmissionId] = useState<string | null>(null);

  useEffect(() => {
    setOpenSubmissionId(null);
  }, [submissions]);

  return (
    <section className={`editor-submission-history ${open ? "open" : ""}`}>
      <button
        className="editor-submission-history-trigger"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span>
          <History size={14} />
          <strong>歷史提交紀錄</strong>
          <em>{submissions.length} 筆</em>
        </span>
        <ChevronDown size={14} className={open ? "rotated" : ""} />
      </button>

      {open && (
        <div className="problem-submission-events">
          {submissions.length ? (
            submissions.map((submission, index) => {
              const submissionOpen = openSubmissionId === submission.id;
              const passedTests =
                submission.results?.filter((result) => result.passed).length ??
                0;
              const totalTests = submission.results?.length;
              const failedResult = firstFailedResult(submission.results);
              const errorReason = failureReason(failedResult);
              const memoryEligible =
                isMemoryEligibleSubmission(submission);
              return (
                <div
                  className={`problem-submission-event ${
                    submissionOpen ? "is-open" : ""
                  }`}
                  key={submission.id}
                >
                  <button
                    className="submission-event-trigger"
                    onClick={() =>
                      setOpenSubmissionId((current) =>
                        current === submission.id ? null : submission.id
                      )
                    }
                    aria-expanded={submissionOpen}
                  >
                    <strong>第 {attempts - index} 次</strong>
                    <span className={submission.passed ? "passed" : "failed"}>
                      {submission.passed ? "AC" : "錯誤"}
                    </span>
                    <span className="submission-test-count">
                      {totalTests === undefined
                        ? "舊紀錄"
                        : `${passedTests}/${totalTests} 測資`}
                    </span>
                    <span
                      className={`submission-memory-evidence ${
                        memoryEligible ? "eligible" : "assisted"
                      }`}
                      title={
                        memoryEligible
                          ? "這次是無提示提取，可作為 FSRS 記憶證據"
                          : "這次有答案或強迫重建協助，只保留練習紀錄"
                      }
                    >
                      {memoryEligible ? "記憶" : "引導"}
                    </span>
                    <span
                      className={`submission-result-reason ${
                        submission.passed ? "passed" : "failed"
                      }`}
                      title={
                        submission.passed
                          ? "全部測資通過"
                          : errorReason
                      }
                    >
                      {submission.passed
                        ? "全部測資通過"
                        : `${
                            failedResult?.errorType ?? "錯誤"
                          } · ${errorReason}`}
                    </span>
                    <time>{submittedAtLabel(submission.submittedAt)}</time>
                    <em>{durationLabel(submission.durationMs)}</em>
                    <ChevronDown size={12} />
                  </button>

                  {submissionOpen && (
                    <>
                      {submission.code === undefined ? (
                        <p>這是舊提交，當時尚未保存程式碼。</p>
                      ) : (
                        <>
                          <div className="submission-snapshot-heading">
                            送出時的程式碼
                          </div>
                          <pre>
                            <code>{submission.code}</code>
                          </pre>
                        </>
                      )}

                      <div className="submission-snapshot-heading">
                        測試結果
                      </div>
                      {submission.results === undefined ? (
                        <p>這是舊提交，當時尚未保存錯誤明細。</p>
                      ) : (
                        <div className="submission-snapshot-results">
                          {submission.results.map((result, resultIndex) => (
                            <div
                              className={`submission-snapshot-result ${
                                result.passed ? "passed" : "failed"
                              }`}
                              key={`${result.name}-${resultIndex}`}
                            >
                              <header>
                                <strong>{result.name}</strong>
                                <span>
                                  {result.passed
                                    ? "Accepted"
                                    : result.errorType ?? "Wrong Answer"}
                                </span>
                              </header>
                              {result.input && (
                                <p>
                                  <b>Input</b>
                                  <code>{result.input}</code>
                                </p>
                              )}
                              {result.error ? (
                                <pre>{result.error}</pre>
                              ) : (
                                !result.passed && (
                                  <div>
                                    <span>
                                      實際 <code>{result.actual}</code>
                                    </span>
                                    <span>
                                      預期 <code>{result.expected}</code>
                                    </span>
                                  </div>
                                )
                              )}
                              {result.stdout && (
                                <pre>stdout: {result.stdout}</pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          ) : (
            <p className="editor-submission-history-empty">
              這一題還沒有提交紀錄。
            </p>
          )}

          {attempts > submissions.length && (
            <small className="editor-submission-history-legacy">
              較早的 {attempts - submissions.length}{" "}
              次提交只有統計，當時尚未保存逐筆紀錄。
            </small>
          )}
        </div>
      )}
    </section>
  );
}
