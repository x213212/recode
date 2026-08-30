import { localDateKey } from "./storage.ts";
import type {
  DailyActivity,
  SubmissionEvent,
  StudyRecord
} from "@/lib/types";

const MAX_SUBMISSION_HISTORY = 20_000;

export function submissionIntensity(submissions: number): number {
  if (submissions <= 0) return 0;
  if (submissions === 1) return 1;
  if (submissions <= 3) return 2;
  if (submissions <= 6) return 3;
  return 4;
}

export function recordSubmission(
  activity: Record<string, DailyActivity>,
  history: SubmissionEvent[],
  event: SubmissionEvent
): {
  activity: Record<string, DailyActivity>;
  submissionHistory: SubmissionEvent[];
} {
  const key = localDateKey(event.submittedAt);
  const day = activity[key] ?? {
    submissions: 0,
    passed: 0,
    failed: 0,
    totalMs: 0
  };

  return {
    activity: {
      ...activity,
      [key]: {
        submissions: day.submissions + 1,
        passed: day.passed + (event.passed ? 1 : 0),
        failed: day.failed + (event.passed ? 0 : 1),
        totalMs: day.totalMs + event.durationMs
      }
    },
    submissionHistory: [event, ...history].slice(
      0,
      MAX_SUBMISSION_HISTORY
    )
  };
}

export function removeProblemSubmissions(
  activity: Record<string, DailyActivity>,
  history: SubmissionEvent[],
  problemId: string,
  _record?: Pick<
    StudyRecord,
    "attempts" | "passed" | "totalMs" | "lastStudiedAt"
  >
): {
  activity: Record<string, DailyActivity>;
  submissionHistory: SubmissionEvent[];
  removed: SubmissionEvent[];
} {
  const removed = history.filter(
    (event) => event.problemId === problemId
  );
  const nextActivity = { ...activity };

  for (const event of removed) {
    const key = localDateKey(event.submittedAt);
    const day = nextActivity[key];
    if (!day) continue;

    const nextDay = {
      submissions: Math.max(0, day.submissions - 1),
      passed: Math.max(0, day.passed - (event.passed ? 1 : 0)),
      failed: Math.max(0, day.failed - (event.passed ? 0 : 1)),
      totalMs: Math.max(0, day.totalMs - event.durationMs)
    };

    if (
      nextDay.submissions === 0 &&
      nextDay.passed === 0 &&
      nextDay.failed === 0 &&
      nextDay.totalMs === 0
    ) {
      delete nextActivity[key];
    } else {
      nextActivity[key] = nextDay;
    }
  }

  // Legacy aggregate counts cannot be attributed to a specific problem with
  // certainty. Guessing that all missing attempts happened on lastStudiedAt
  // can subtract another problem's activity, so only proven events are removed.

  return {
    activity: nextActivity,
    submissionHistory: history.filter(
      (event) => event.problemId !== problemId
    ),
    removed
  };
}
