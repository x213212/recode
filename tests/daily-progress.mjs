import assert from "node:assert/strict";

import { summarizeDailyProgress } from "../lib/dailyProgress.ts";
import {
  abandonRound,
  deferRound,
  recordFsrsWrite,
  recordSubmission,
  startOrResumeRound
} from "../lib/recallRound.ts";

const event = (overrides = {}) => ({
  eventId: "event-1",
  roundId: "round-1",
  problemId: "two-sum",
  at: "2026-08-26T01:00:00.000Z",
  ...overrides
});

// A WA followed by AC is two submissions but one unique touched/completed item.
let rounds = startOrResumeRound([], {
  ...event({ eventId: "start-1" }),
  mode: "guided",
  origin: "daily-training"
});
rounds = recordSubmission(rounds, {
  ...event({ eventId: "wa-1" }),
  passed: false,
  memoryEligible: true
});
rounds = recordSubmission(rounds, {
  ...event({ eventId: "ac-1" }),
  passed: true,
  memoryEligible: true
});
rounds = recordFsrsWrite(rounds, event({ eventId: "fsrs-1" }));

let summary = summarizeDailyProgress(rounds, [], "2026-08-26");
assert.deepEqual([...summary.touchedProblemIds], ["two-sum"]);
assert.deepEqual([...summary.independentCompletedProblemIds], ["two-sum"]);
assert.deepEqual([...summary.assistedCompletedProblemIds], []);
assert.deepEqual([...summary.unfinishedProblemIds], []);
assert.equal(summary.submissions, 2);
assert.equal(summary.failures, 1);
assert.equal(summary.fsrsWrites, 1);

// Legacy events (no roundId) remain visible and use the established evidence
// fallback. A rated legacy AC represents one historical FSRS write.
const legacyHistory = [
  {
    id: "legacy-wa",
    problemId: "valid-parentheses",
    submittedAt: "2026-08-26T02:00:00.000Z",
    passed: false,
    durationMs: 1200
  },
  {
    id: "legacy-assisted-ac",
    problemId: "valid-parentheses",
    submittedAt: "2026-08-26T02:05:00.000Z",
    passed: true,
    durationMs: 1800,
    answerRevealCount: 1,
    inferredRating: "good"
  },
  {
    id: "legacy-independent-ac",
    problemId: "binary-search",
    submittedAt: "2026-08-26T03:00:00.000Z",
    passed: true,
    durationMs: 900,
    memoryEligible: true,
    inferredRating: "easy"
  }
];
summary = summarizeDailyProgress([], legacyHistory, "2026-08-26");
assert.deepEqual(
  [...summary.touchedProblemIds],
  ["valid-parentheses", "binary-search"]
);
assert.deepEqual(
  [...summary.independentCompletedProblemIds],
  ["binary-search"]
);
assert.deepEqual(
  [...summary.assistedCompletedProblemIds],
  ["valid-parentheses"]
);
assert.equal(summary.submissions, 3);
assert.equal(summary.failures, 1);
assert.equal(summary.fsrsWrites, 2);

// New submission events are represented by their round and must never be
// counted a second time by the legacy fallback.
const mirroredNewHistory = [
  {
    id: "new-wa",
    roundId: "round-1",
    problemId: "two-sum",
    submittedAt: "2026-08-26T01:00:00.000Z",
    passed: false,
    durationMs: 100,
    inferredRating: "again"
  },
  {
    id: "new-ac",
    roundId: "round-1",
    problemId: "two-sum",
    submittedAt: "2026-08-26T01:01:00.000Z",
    passed: true,
    durationMs: 100,
    memoryEligible: true,
    inferredRating: "good"
  }
];
summary = summarizeDailyProgress(rounds, mirroredNewHistory, "2026-08-26");
assert.equal(summary.submissions, 2);
assert.equal(summary.failures, 1);
assert.equal(summary.fsrsWrites, 1);
assert.equal(summary.touchedProblemIds.size, 1);

// Deferred/abandoned rounds remain explicit; unfinished is derived from the
// final union so a later completion of the same problem wins.
let unfinished = startOrResumeRound([], {
  ...event({ eventId: "defer-start", roundId: "defer-round", problemId: "lru" }),
  mode: "free",
  origin: "queue"
});
unfinished = deferRound(
  unfinished,
  event({ eventId: "defer-close", roundId: "defer-round", problemId: "lru" })
);
unfinished = startOrResumeRound(unfinished, {
  ...event({
    eventId: "abandon-start",
    roundId: "abandon-round",
    problemId: "trie"
  }),
  mode: "free",
  origin: "queue"
});
unfinished = abandonRound(
  unfinished,
  event({
    eventId: "abandon-close",
    roundId: "abandon-round",
    problemId: "trie"
  })
);
summary = summarizeDailyProgress(unfinished, [], "2026-08-26");
assert.deepEqual([...summary.deferredProblemIds], ["lru"]);
assert.deepEqual([...summary.abandonedProblemIds], ["trie"]);
assert.deepEqual([...summary.unfinishedProblemIds].sort(), ["lru", "trie"]);

// UTC 15:59 is still Aug 26 in Taipei; UTC 16:00 starts Aug 27.
const midnightHistory = [
  {
    id: "before-midnight",
    problemId: "before",
    submittedAt: "2026-08-26T15:59:59.999Z",
    passed: true,
    durationMs: 1
  },
  {
    id: "after-midnight",
    problemId: "after",
    submittedAt: "2026-08-26T16:00:00.000Z",
    passed: false,
    durationMs: 1
  }
];
const aug26 = summarizeDailyProgress([], midnightHistory, "2026-08-26");
const aug27 = summarizeDailyProgress([], midnightHistory, "2026-08-27");
assert.deepEqual([...aug26.touchedProblemIds], ["before"]);
assert.deepEqual([...aug27.touchedProblemIds], ["after"]);
assert.equal(aug26.failures, 0);
assert.equal(aug27.failures, 1);

console.log(
  "Daily progress tests passed: unique rounds, legacy fallback, no double-counting, and Taipei midnight."
);
