import { isMemoryEligibleSubmission } from "./memoryEvidence.ts";
import {
  recallStudyDateKey,
  summarizeRecallDay,
  type RecallRound
} from "./recallRound.ts";
import type { SubmissionEvent } from "./types.ts";

export interface DailyProgress {
  dateKey: string;
  touchedProblemIds: ReadonlySet<string>;
  independentCompletedProblemIds: ReadonlySet<string>;
  assistedCompletedProblemIds: ReadonlySet<string>;
  completedProblemIds: ReadonlySet<string>;
  unfinishedProblemIds: ReadonlySet<string>;
  deferredProblemIds: ReadonlySet<string>;
  abandonedProblemIds: ReadonlySet<string>;
  fsrsProblemIds: ReadonlySet<string>;
  submissions: number;
  failures: number;
  fsrsWrites: number;
}

function requestedDateKey(value: Date | number | string): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : recallStudyDateKey(value);
}

function eventDateKey(event: SubmissionEvent): string | null {
  try {
    return recallStudyDateKey(event.submittedAt);
  } catch {
    // Corrupt legacy history should not make the whole dashboard unavailable.
    return null;
  }
}

/**
 * Combines durable RecallRound aggregates with pre-round submission history.
 *
 * Submission events carrying a roundId are deliberately ignored here: their
 * counts and evidence already live in RecallRound.days. Only events from the
 * legacy schema (without roundId) are used as a compatibility fallback.
 */
export function summarizeDailyProgress(
  recallRounds: readonly RecallRound[] | null | undefined,
  submissionHistory: readonly SubmissionEvent[] | null | undefined,
  date: Date | number | string = new Date()
): DailyProgress {
  const dateKey = requestedDateKey(date);
  const roundSummary = summarizeRecallDay(recallRounds, dateKey);
  const touchedProblemIds = new Set(roundSummary.touchedProblemIds);
  const independentCompletedProblemIds = new Set(
    roundSummary.independentCompletedProblemIds
  );
  const assistedCompletedProblemIds = new Set(
    roundSummary.assistedCompletedProblemIds
  );
  const deferredProblemIds = new Set(roundSummary.deferredProblemIds);
  const abandonedProblemIds = new Set(roundSummary.abandonedProblemIds);
  const fsrsProblemIds = new Set(roundSummary.fsrsProblemIds);
  let submissions = roundSummary.submissions;
  let failures = roundSummary.failures;
  let fsrsWrites = roundSummary.fsrsWrites;

  if (Array.isArray(submissionHistory)) {
    for (const candidate of submissionHistory) {
      if (!candidate || typeof candidate !== "object") continue;
      const event = candidate as SubmissionEvent;
      if (typeof event.roundId === "string" && event.roundId.trim()) continue;
      if (
        typeof event.problemId !== "string" ||
        !event.problemId.trim() ||
        typeof event.passed !== "boolean" ||
        eventDateKey(event) !== dateKey
      ) {
        continue;
      }

      const problemId = event.problemId.trim();
      touchedProblemIds.add(problemId);
      submissions += 1;
      if (!event.passed) {
        failures += 1;
      } else if (isMemoryEligibleSubmission(event)) {
        independentCompletedProblemIds.add(problemId);
      } else {
        assistedCompletedProblemIds.add(problemId);
      }

      if (event.inferredRating) {
        fsrsWrites += 1;
        fsrsProblemIds.add(problemId);
      }
    }
  }

  const completedProblemIds = new Set([
    ...independentCompletedProblemIds,
    ...assistedCompletedProblemIds
  ]);
  const unfinishedProblemIds = new Set(
    [...touchedProblemIds].filter(
      (problemId) => !completedProblemIds.has(problemId)
    )
  );

  return {
    dateKey,
    touchedProblemIds,
    independentCompletedProblemIds,
    assistedCompletedProblemIds,
    completedProblemIds,
    unfinishedProblemIds,
    deferredProblemIds,
    abandonedProblemIds,
    fsrsProblemIds,
    submissions,
    failures,
    fsrsWrites
  };
}

export const dailyProgress = summarizeDailyProgress;
