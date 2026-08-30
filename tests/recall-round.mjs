import assert from "node:assert/strict";

import {
  activeRecallRound,
  abandonRound,
  capRecallRoundHistory,
  closeRecallRound,
  emptyRecallRoundHistory,
  markRecallRoundAssisted,
  normalizeRecallRoundHistory,
  recallStudyDateKey,
  recordRecallFsrsWrite,
  recordRecallSubmission,
  resumeRecallRound,
  startRecallRound,
  startOrResumeRound,
  summarizeRecallDay
} from "../lib/recallRound.ts";

const event = (overrides = {}) => ({
  eventId: "event-1",
  roundId: "round-1",
  problemId: "two-sum",
  at: "2026-08-26T01:00:00.000Z",
  ...overrides
});

// One failed submit followed by AC is still one unique problem touched/completed.
let history = startRecallRound(emptyRecallRoundHistory(), {
  ...event({ eventId: "start-1" }),
  mode: "guided",
  origin: "daily-training"
});
history = recordRecallSubmission(history, {
  ...event({ eventId: "fail-1", at: "2026-08-26T01:05:00.000Z" }),
  passed: false,
  memoryEligible: true
});
history = recordRecallSubmission(history, {
  ...event({ eventId: "ac-1", at: "2026-08-26T01:10:00.000Z" }),
  passed: true,
  memoryEligible: true
});
history = recordRecallFsrsWrite(history, {
  ...event({ eventId: "fsrs-1", at: "2026-08-26T01:10:01.000Z" })
});

let summary = summarizeRecallDay(history, "2026-08-26");
assert.deepEqual([...summary.touchedProblemIds], ["two-sum"]);
assert.deepEqual([...summary.independentCompletedProblemIds], ["two-sum"]);
assert.deepEqual([...summary.unfinishedProblemIds], []);
assert.equal(summary.submissions, 2);
assert.equal(summary.failures, 1);
assert.equal(summary.fsrsWrites, 1);
assert.equal(history.rounds[0].state, "completed");
assert.equal(history.rounds[0].submissionCount, 2);

// Replaying an operation ID must not double count a submit or FSRS write.
const duplicateAc = recordRecallSubmission(history, {
  ...event({ eventId: "ac-1", at: "2026-08-26T01:10:00.000Z" }),
  passed: true,
  memoryEligible: true
});
const duplicateFsrs = recordRecallFsrsWrite(duplicateAc, {
  ...event({ eventId: "fsrs-2", at: "2026-08-26T01:10:02.000Z" })
});
summary = summarizeRecallDay(duplicateFsrs, "2026-08-26");
assert.equal(summary.submissions, 2);
assert.equal(summary.fsrsWrites, 1, "同一回合最多只能寫入一次 FSRS");

// Repeat is assisted from start and remains one touched problem despite retries.
let repeatHistory = startRecallRound(emptyRecallRoundHistory(), {
  ...event({
    eventId: "repeat-start",
    roundId: "repeat-round",
    problemId: "reverse-list"
  }),
  mode: "repeat",
  origin: "repeat-queue"
});
for (let index = 0; index < 3; index += 1) {
  repeatHistory = recordRecallSubmission(repeatHistory, {
    ...event({
      eventId: `repeat-submit-${index}`,
      roundId: "repeat-round",
      problemId: "reverse-list",
      at: `2026-08-26T02:0${index}:00.000Z`
    }),
    passed: index === 2,
    memoryEligible: false
  });
}
const repeatSummary = summarizeRecallDay(repeatHistory, "2026-08-26");
assert.deepEqual([...repeatSummary.touchedProblemIds], ["reverse-list"]);
assert.deepEqual(
  [...repeatSummary.assistedCompletedProblemIds],
  ["reverse-list"]
);
assert.equal(repeatSummary.submissions, 3);
assert.equal(repeatHistory.rounds[0].evidence, "assisted");

// Assistance is sticky: a later submission claiming eligibility remains assisted.
let assisted = startRecallRound(emptyRecallRoundHistory(), {
  ...event({ eventId: "sticky-start", roundId: "sticky-round" }),
  mode: "free",
  origin: "random"
});
assisted = markRecallRoundAssisted(assisted, {
  ...event({ eventId: "answer-open", roundId: "sticky-round" })
});
assisted = recordRecallSubmission(assisted, {
  ...event({ eventId: "sticky-ac", roundId: "sticky-round" }),
  passed: true,
  memoryEligible: true
});
assisted = recordRecallFsrsWrite(assisted, {
  ...event({ eventId: "illegal-fsrs", roundId: "sticky-round" })
});
const assistedSummary = summarizeRecallDay(assisted, "2026-08-26");
assert.deepEqual([...assistedSummary.independentCompletedProblemIds], []);
assert.deepEqual([...assistedSummary.assistedCompletedProblemIds], ["two-sum"]);
assert.equal(assistedSummary.fsrsWrites, 0);

// Skip/defer closes without completion, can resume, and cannot reset evidence.
let deferred = startRecallRound(emptyRecallRoundHistory(), {
  ...event({ eventId: "defer-start", roundId: "defer-round" }),
  mode: "interview",
  origin: "queue-next"
});
deferred = closeRecallRound(deferred, {
  ...event({ eventId: "defer", roundId: "defer-round" }),
  outcome: "deferred"
});
let deferredSummary = summarizeRecallDay(deferred, "2026-08-26");
assert.deepEqual([...deferredSummary.deferredProblemIds], ["two-sum"]);
assert.deepEqual([...deferredSummary.unfinishedProblemIds], ["two-sum"]);
deferred = resumeRecallRound(deferred, {
  ...event({
    eventId: "resume",
    roundId: "defer-round",
    at: "2026-08-26T03:00:00.000Z"
  })
});
deferred = recordRecallSubmission(deferred, {
  ...event({
    eventId: "resumed-ac",
    roundId: "defer-round",
    at: "2026-08-26T03:05:00.000Z"
  }),
  passed: true,
  memoryEligible: true
});
assert.equal(deferred.rounds[0].state, "completed");
assert.equal(deferred.rounds[0].resumeCount, 1);
assert.equal(deferred.rounds[0].mode, "interview", "resume 不可改寫模式快照");

// Abandoned/completed rounds are terminal; only deferred rounds are resumable.
let abandoned = startRecallRound(emptyRecallRoundHistory(), {
  ...event({ eventId: "abandon-start", roundId: "abandon-round" }),
  mode: "free",
  origin: "search"
});
abandoned = closeRecallRound(abandoned, {
  ...event({ eventId: "abandon", roundId: "abandon-round" }),
  outcome: "abandoned"
});
const abandonedAfterResume = resumeRecallRound(abandoned, {
  ...event({ eventId: "bad-resume", roundId: "abandon-round" })
});
assert.equal(abandonedAfterResume.rounds[0].state, "abandoned");
assert.equal(abandonedAfterResume.rounds[0].resumeCount, 0);

// Taipei midnight is explicit and not dependent on the process timezone.
assert.equal(recallStudyDateKey("2026-08-26T15:59:59.000Z"), "2026-08-26");
assert.equal(recallStudyDateKey("2026-08-26T16:00:00.000Z"), "2026-08-27");
let midnight = startRecallRound(emptyRecallRoundHistory(), {
  ...event({
    eventId: "midnight-start",
    roundId: "midnight-round",
    problemId: "merge-intervals",
    at: "2026-08-26T15:59:59.000Z"
  }),
  mode: "guided",
  origin: "daily-training"
});
midnight = recordRecallSubmission(midnight, {
  ...event({
    eventId: "midnight-ac",
    roundId: "midnight-round",
    problemId: "merge-intervals",
    at: "2026-08-26T16:00:01.000Z"
  }),
  passed: true,
  memoryEligible: true
});
const beforeMidnight = summarizeRecallDay(midnight, "2026-08-26");
const afterMidnight = summarizeRecallDay(midnight, "2026-08-27");
assert.deepEqual([...beforeMidnight.touchedProblemIds], ["merge-intervals"]);
assert.deepEqual([...beforeMidnight.unfinishedProblemIds], ["merge-intervals"]);
assert.equal(beforeMidnight.submissions, 0);
assert.deepEqual(
  [...afterMidnight.independentCompletedProblemIds],
  ["merge-intervals"]
);
assert.equal(afterMidnight.submissions, 1);

// Malformed/legacy data is repaired without inventing memory success.
const normalized = normalizeRecallRoundHistory({
  rounds: [
    null,
    { id: "missing-problem" },
    {
      roundId: "legacy-round",
      problemId: "legacy-problem",
      startedAt: "2026-08-26T00:00:00Z",
      status: "completed",
      submissions: -10,
      failures: "bad",
      eventIds: ["same", "same", null]
    }
  ]
});
assert.equal(normalized.rounds.length, 1);
assert.equal(normalized.rounds[0].state, "active");
assert.equal(normalized.rounds[0].submissionCount, 0);
assert.deepEqual(normalized.rounds[0].eventIds, ["same"]);

// Capping never deletes live or resumable work.
const capped = capRecallRoundHistory(
  {
    version: 1,
    rounds: [
      {
        ...deferred.rounds[0],
        id: "still-deferred",
        state: "deferred",
        closedAt: "2026-08-26T04:00:00.000Z",
        updatedAt: "2026-08-26T04:00:00.000Z"
      },
      abandoned.rounds[0],
      history.rounds[0]
    ]
  },
  1
);
assert.deepEqual(
  capped.rounds.map((round) => round.id),
  ["still-deferred"],
  "active/deferred rounds take priority over terminal history"
);

// Array integration resumes a deferred same-mode round, but not abandoned work.
let arrayRounds = startOrResumeRound([], {
  ...event({ eventId: "array-start", roundId: "array-round" }),
  mode: "free",
  origin: "random"
});
arrayRounds = closeRecallRound(arrayRounds, {
  ...event({ eventId: "array-defer", roundId: "array-round" }),
  outcome: "deferred"
}).rounds;
arrayRounds = startOrResumeRound(arrayRounds, {
  ...event({
    eventId: "array-resume",
    roundId: "must-not-create",
    at: "2026-08-26T04:00:00.000Z"
  }),
  mode: "free",
  origin: "changed-origin-is-ignored"
});
assert.equal(arrayRounds.length, 1);
assert.equal(activeRecallRound(arrayRounds, "two-sum")?.id, "array-round");
assert.equal(arrayRounds[0].origin, "random");
arrayRounds = abandonRound(arrayRounds, {
  ...event({
    eventId: "array-abandon",
    roundId: "array-round",
    at: "2026-08-26T04:05:00.000Z"
  })
});
arrayRounds = startOrResumeRound(arrayRounds, {
  ...event({
    eventId: "new-after-abandon",
    roundId: "fresh-round",
    at: "2026-08-26T04:06:00.000Z"
  }),
  mode: "free",
  origin: "queue"
});
assert.equal(arrayRounds.length, 2);
assert.equal(activeRecallRound(arrayRounds, "two-sum")?.id, "fresh-round");

// A meaningful assisted re-entry upgrades an active round instead of creating
// a second round, and a second same-day round cannot write FSRS twice.
let activeAssist = startOrResumeRound([], {
  ...event({ eventId: "active-assist-start", roundId: "active-assist-round" }),
  mode: "free",
  origin: "queue"
});
activeAssist = startOrResumeRound(activeAssist, {
  ...event({ eventId: "active-assist-help", roundId: "unused-round" }),
  mode: "free",
  origin: "queue",
  assisted: true
});
assert.equal(activeAssist.length, 1);
assert.equal(activeAssist[0].evidence, "assisted");

let secondSameDay = startRecallRound(history, {
  ...event({ eventId: "second-start", roundId: "second-round" }),
  mode: "guided",
  origin: "history"
});
secondSameDay = recordRecallSubmission(secondSameDay, {
  ...event({ eventId: "second-ac", roundId: "second-round" }),
  passed: true,
  memoryEligible: true
});
secondSameDay = recordRecallFsrsWrite(secondSameDay, {
  ...event({ eventId: "second-fsrs", roundId: "second-round" })
});
assert.equal(
  summarizeRecallDay(secondSameDay, "2026-08-26").fsrsWrites,
  1,
  "同一題同一天即使誤開第二回合，也不可重複推高 FSRS"
);

// Input snapshots remain untouched by immutable reducers.
const frozen = structuredClone(midnight);
recordRecallFsrsWrite(midnight, {
  ...event({
    eventId: "midnight-fsrs",
    roundId: "midnight-round",
    problemId: "merge-intervals",
    at: "2026-08-26T16:00:02.000Z"
  })
});
assert.deepEqual(midnight, frozen);

console.log(
  "RecallRound 測試通過：唯一題數、sticky assistance、延期恢復、跨日、去重與安全裁切。"
);
