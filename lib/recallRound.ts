/**
 * Durable, UI-independent activity accounting for one meaningful attempt at a
 * problem. A queue entry is not a round: callers should start a round only
 * after meaningful work (editing, starting the timer, revealing help, or the
 * first submission).
 *
 * The model stores compact per-day aggregates rather than deriving completion
 * from the navigation queue. All update helpers are immutable and idempotent
 * by eventId, which makes them safe to replay after tab/session recovery.
 */

export const RECALL_ROUND_VERSION = 1 as const;
export const MAX_RECALL_ROUND_HISTORY = 5_000;
export const RECALL_STUDY_TIME_ZONE = "Asia/Taipei";

export type RecallRoundMode =
  | "guided"
  | "free"
  | "explore"
  | "interview"
  | "speed"
  | "repeat"
  | "unknown";

export type RecallRoundState =
  | "active"
  | "deferred"
  | "abandoned"
  | "completed";

export type RecallEvidence = "independent" | "assisted";

export interface RecallRoundDayActivity {
  touched: boolean;
  submissions: number;
  failures: number;
  independentAccepted: boolean;
  assistedAccepted: boolean;
  deferred: boolean;
  abandoned: boolean;
  fsrsWrites: number;
}

export interface RecallRound {
  version: typeof RECALL_ROUND_VERSION;
  id: string;
  problemId: string;
  /** Mode is captured at meaningful start and never changed by resume. */
  mode: RecallRoundMode;
  /** Navigation source captured at meaningful start (queue, random, plan...). */
  origin: string;
  startedAt: string;
  updatedAt: string;
  closedAt?: string;
  state: RecallRoundState;
  /** Sticky: once assisted, this round can never become independent again. */
  evidence: RecallEvidence;
  completionEvidence?: RecallEvidence;
  submissionCount: number;
  failureCount: number;
  resumeCount: number;
  fsrsWriteCount: number;
  days: Record<string, RecallRoundDayActivity>;
  /** Applied operation IDs make reducer calls idempotent. */
  eventIds: string[];
}

export interface RecallRoundHistory {
  version: typeof RECALL_ROUND_VERSION;
  rounds: RecallRound[];
}

interface RecallEventBase {
  eventId: string;
  roundId: string;
  problemId: string;
  at: Date | number | string;
}

export interface RecallStartEvent extends RecallEventBase {
  kind: "start";
  mode: RecallRoundMode;
  origin: string;
  /** Repeat and other guided starts should opt into assisted evidence. */
  assisted?: boolean;
}

export interface RecallAssistanceEvent extends RecallEventBase {
  kind: "assistance";
}

export interface RecallSubmissionEvent extends RecallEventBase {
  kind: "submission";
  passed: boolean;
  /** false is sticky, even if a later submission claims to be independent. */
  memoryEligible: boolean;
}

export interface RecallCloseEvent extends RecallEventBase {
  kind: "close";
  outcome: "deferred" | "abandoned";
}

export interface RecallResumeEvent extends RecallEventBase {
  kind: "resume";
}

export interface RecallFsrsWriteEvent extends RecallEventBase {
  kind: "fsrs-write";
}

export type RecallRoundEvent =
  | RecallStartEvent
  | RecallAssistanceEvent
  | RecallSubmissionEvent
  | RecallCloseEvent
  | RecallResumeEvent
  | RecallFsrsWriteEvent;

export interface RecallDailySummary {
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

const MODES = new Set<RecallRoundMode>([
  "guided",
  "free",
  "explore",
  "interview",
  "speed",
  "repeat",
  "unknown"
]);

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_COUNTER = 1_000_000_000;

const taipeiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RECALL_STUDY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function emptyDay(): RecallRoundDayActivity {
  return {
    touched: false,
    submissions: 0,
    failures: 0,
    independentAccepted: false,
    assistedAccepted: false,
    deferred: false,
    abandoned: false,
    fsrsWrites: 0
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, fallback: string, max = 160): string {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text ? text.slice(0, max) : fallback;
}

function nonNegativeInteger(value: unknown): number {
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && value.trim() !== "")
  ) {
    return 0;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(MAX_COUNTER, Math.floor(number));
}

function toIso(value: unknown): string | null {
  if (
    !(value instanceof Date) &&
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }
  if (typeof value === "string" && !value.trim()) return null;
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? date.toISOString() : null;
}

function normalizeMode(value: unknown): RecallRoundMode {
  return typeof value === "string" && MODES.has(value as RecallRoundMode)
    ? (value as RecallRoundMode)
    : "unknown";
}

function normalizeState(value: unknown): RecallRoundState {
  return value === "deferred" ||
    value === "abandoned" ||
    value === "completed"
    ? value
    : "active";
}

function normalizeEvidence(value: unknown, mode: RecallRoundMode): RecallEvidence {
  return value === "assisted" || mode === "repeat"
    ? "assisted"
    : "independent";
}

function normalizeDay(value: unknown): RecallRoundDayActivity {
  const input = objectValue(value) ?? {};
  const submissions = nonNegativeInteger(input.submissions);
  return {
    touched: input.touched === true,
    submissions,
    failures: Math.min(submissions, nonNegativeInteger(input.failures)),
    independentAccepted: input.independentAccepted === true,
    assistedAccepted: input.assistedAccepted === true,
    deferred: input.deferred === true,
    abandoned: input.abandoned === true,
    fsrsWrites: Math.min(1, nonNegativeInteger(input.fsrsWrites))
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const id = candidate.trim().slice(0, 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function eventDateKey(at: string): string {
  return recallStudyDateKey(at);
}

function dayWith(
  round: RecallRound,
  dateKey: string,
  update: (day: RecallRoundDayActivity) => RecallRoundDayActivity
): Record<string, RecallRoundDayActivity> {
  return {
    ...round.days,
    [dateKey]: update(round.days[dateKey] ?? emptyDay())
  };
}

/** Returns the calendar day in Taipei regardless of browser/system timezone. */
export function recallStudyDateKey(
  value: Date | number | string = new Date()
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("Invalid recall activity timestamp");
  }
  const parts = taipeiDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new RangeError("Unable to calculate Taipei study date");
  }
  return `${year}-${month}-${day}`;
}

export function emptyRecallRoundHistory(): RecallRoundHistory {
  return { version: RECALL_ROUND_VERSION, rounds: [] };
}

/**
 * Repairs persisted history conservatively. It never invents an independent
 * completion or FSRS write from malformed data.
 */
export function normalizeRecallRound(value: unknown): RecallRound | null {
  const input = objectValue(value);
  if (!input) return null;

  const id = cleanText(input.id ?? input.roundId, "", 200);
  const problemId = cleanText(input.problemId, "", 200);
  const startedAt = toIso(input.startedAt);
  if (!id || !problemId || !startedAt) return null;

  const mode = normalizeMode(input.mode ?? input.practiceMode);
  let evidence = normalizeEvidence(
    input.evidence ?? (input.assisted === true ? "assisted" : undefined),
    mode
  );
  let state = normalizeState(input.state ?? input.status ?? input.outcome);
  const rawUpdatedAt = toIso(input.updatedAt);
  const updatedAt =
    rawUpdatedAt && Date.parse(rawUpdatedAt) >= Date.parse(startedAt)
      ? rawUpdatedAt
      : startedAt;
  const rawClosedAt = toIso(input.closedAt ?? input.completedAt);
  let closedAt =
    rawClosedAt && Date.parse(rawClosedAt) >= Date.parse(startedAt)
      ? rawClosedAt
      : undefined;
  const days: Record<string, RecallRoundDayActivity> = {};
  const rawDays = objectValue(input.days);
  if (rawDays) {
    for (const [dateKey, day] of Object.entries(rawDays)) {
      if (!DATE_KEY_PATTERN.test(dateKey)) continue;
      days[dateKey] = normalizeDay(day);
    }
  }

  // Completion belongs to exactly one accepted event. Persisted day buckets
  // may be malformed, so rebuild these flags from the terminal snapshot below.
  for (const [dateKey, day] of Object.entries(days)) {
    days[dateKey] = {
      ...day,
      independentAccepted: false,
      assistedAccepted: false
    };
  }

  const startedDate = eventDateKey(startedAt);
  days[startedDate] = {
    ...(days[startedDate] ?? emptyDay()),
    touched: true
  };

  let completionEvidence: RecallEvidence | undefined =
    input.completionEvidence === "independent" ||
    input.completionEvidence === "assisted"
      ? input.completionEvidence
      : undefined;
  if (evidence === "assisted" && completionEvidence === "independent") {
    completionEvidence = "assisted";
  }

  if (state === "completed" && (!completionEvidence || !closedAt)) {
    // A legacy/malformed "completed" flag without evidence must not grant
    // completion or an FSRS write. Keep the work recoverable instead.
    state = "active";
    closedAt = undefined;
    completionEvidence = undefined;
  }

  if ((state === "deferred" || state === "abandoned") && !closedAt) {
    state = "active";
  }

  if (state === "completed" && completionEvidence && closedAt) {
    const completedDate = eventDateKey(closedAt);
    const completedDay = days[completedDate] ?? emptyDay();
    days[completedDate] = {
      ...completedDay,
      touched: true,
      independentAccepted:
        completedDay.independentAccepted ||
        completionEvidence === "independent",
      assistedAccepted:
        completedDay.assistedAccepted || completionEvidence === "assisted"
    };
  }

  if ((state === "deferred" || state === "abandoned") && closedAt) {
    const closedDate = eventDateKey(closedAt);
    const closedDay = days[closedDate] ?? emptyDay();
    days[closedDate] = {
      ...closedDay,
      touched: true,
      deferred: closedDay.deferred || state === "deferred",
      abandoned: closedDay.abandoned || state === "abandoned"
    };
  }

  // An assisted completion can never legitimately have written FSRS.
  let fsrsWriteCount = 0;
  for (const [dateKey, day] of Object.entries(days)) {
    if (completionEvidence !== "independent") {
      days[dateKey] = { ...day, fsrsWrites: 0 };
      continue;
    }
    if (day.fsrsWrites > 0 && fsrsWriteCount === 0) {
      fsrsWriteCount = 1;
    } else if (day.fsrsWrites > 0) {
      days[dateKey] = { ...day, fsrsWrites: 0 };
    }
  }

  const inferredSubmissions = Object.values(days).reduce(
    (total, day) => total + day.submissions,
    0
  );
  const inferredFailures = Object.values(days).reduce(
    (total, day) => total + day.failures,
    0
  );
  const submissionCount = Math.max(
    inferredSubmissions,
    nonNegativeInteger(input.submissionCount ?? input.submissions)
  );
  const failureCount = Math.min(
    submissionCount,
    Math.max(
      inferredFailures,
      nonNegativeInteger(input.failureCount ?? input.failures)
    )
  );

  if (completionEvidence === "assisted") evidence = "assisted";

  return {
    version: RECALL_ROUND_VERSION,
    id,
    problemId,
    mode,
    origin: cleanText(input.origin, "unknown", 160),
    startedAt,
    updatedAt,
    ...(closedAt ? { closedAt } : {}),
    state,
    evidence,
    ...(completionEvidence ? { completionEvidence } : {}),
    submissionCount,
    failureCount,
    resumeCount: nonNegativeInteger(input.resumeCount),
    fsrsWriteCount,
    days,
    eventIds: uniqueStrings(input.eventIds)
  };
}

export function normalizeRecallRoundHistory(
  value: unknown,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRoundHistory {
  const input = objectValue(value);
  const rawRounds = Array.isArray(value)
    ? value
    : Array.isArray(input?.rounds)
      ? input.rounds
      : [];
  const roundIds = new Set<string>();
  const eventIds = new Set<string>();
  const rounds: RecallRound[] = [];

  for (const rawRound of rawRounds) {
    const round = normalizeRecallRound(rawRound);
    if (!round || roundIds.has(round.id)) continue;
    roundIds.add(round.id);
    round.eventIds = round.eventIds.filter((eventId) => {
      if (eventIds.has(eventId)) return false;
      eventIds.add(eventId);
      return true;
    });
    rounds.push(round);
  }

  return capRecallRoundHistory(
    { version: RECALL_ROUND_VERSION, rounds },
    maxRounds
  );
}

/**
 * Keeps every active/deferred (resumable) round and trims only terminal rounds.
 * This can intentionally exceed maxRounds when trimming would lose live work.
 */
export function capRecallRoundHistory(
  history: RecallRoundHistory,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRoundHistory {
  const limit = Math.max(0, Math.floor(Number(maxRounds) || 0));
  const protectedRounds = history.rounds.filter(
    (round) => round.state === "active" || round.state === "deferred"
  );
  const protectedIds = new Set(protectedRounds.map((round) => round.id));
  const terminalBudget = Math.max(0, limit - protectedRounds.length);
  const terminalIds = new Set(
    history.rounds
      .filter((round) => !protectedIds.has(round.id))
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
      )
      .slice(0, terminalBudget)
      .map((round) => round.id)
  );
  const rounds = history.rounds.filter(
    (round) => protectedIds.has(round.id) || terminalIds.has(round.id)
  );
  return rounds.length === history.rounds.length
    ? history
    : { version: RECALL_ROUND_VERSION, rounds };
}

function normalizeEvent(event: RecallRoundEvent): (RecallRoundEvent & { at: string }) | null {
  const eventId = cleanText(event.eventId, "", 200);
  const roundId = cleanText(event.roundId, "", 200);
  const problemId = cleanText(event.problemId, "", 200);
  const at = toIso(event.at);
  if (!eventId || !roundId || !problemId || !at) return null;

  if (event.kind === "start") {
    return {
      ...event,
      eventId,
      roundId,
      problemId,
      at,
      mode: normalizeMode(event.mode),
      origin: cleanText(event.origin, "unknown", 160),
      assisted: event.assisted === true
    };
  }
  if (event.kind === "submission") {
    if (typeof event.passed !== "boolean") return null;
    return {
      ...event,
      eventId,
      roundId,
      problemId,
      at,
      memoryEligible: event.memoryEligible === true
    };
  }
  if (event.kind === "close") {
    if (event.outcome !== "deferred" && event.outcome !== "abandoned") {
      return null;
    }
    return { ...event, eventId, roundId, problemId, at };
  }
  if (
    event.kind === "assistance" ||
    event.kind === "resume" ||
    event.kind === "fsrs-write"
  ) {
    return { ...event, eventId, roundId, problemId, at };
  }
  return null;
}

function applyToRound(
  round: RecallRound,
  event: Exclude<RecallRoundEvent, RecallStartEvent> & { at: string }
): RecallRound {
  if (
    round.problemId !== event.problemId ||
    round.eventIds.includes(event.eventId) ||
    Date.parse(event.at) < Date.parse(round.startedAt)
  ) {
    return round;
  }

  const dateKey = eventDateKey(event.at);
  const withEvent = (updates: Partial<RecallRound>): RecallRound => ({
    ...round,
    ...updates,
    updatedAt: event.at,
    eventIds: [...round.eventIds, event.eventId]
  });

  if (event.kind === "resume") {
    if (
      round.state !== "deferred" ||
      (round.closedAt && Date.parse(event.at) < Date.parse(round.closedAt))
    ) {
      return round;
    }
    return withEvent({
      state: "active",
      closedAt: undefined,
      resumeCount: round.resumeCount + 1,
      days: dayWith(round, dateKey, (day) => ({ ...day, touched: true }))
    });
  }

  if (event.kind === "fsrs-write") {
    if (
      round.state !== "completed" ||
      round.completionEvidence !== "independent" ||
      round.fsrsWriteCount > 0 ||
      (round.closedAt && Date.parse(event.at) < Date.parse(round.closedAt))
    ) {
      return round;
    }
    return withEvent({
      fsrsWriteCount: 1,
      days: dayWith(round, dateKey, (day) => ({
        ...day,
        touched: true,
        fsrsWrites: 1
      }))
    });
  }

  if (round.state !== "active") return round;

  if (event.kind === "assistance") {
    return withEvent({
      evidence: "assisted",
      days: dayWith(round, dateKey, (day) => ({ ...day, touched: true }))
    });
  }

  if (event.kind === "close") {
    return withEvent({
      state: event.outcome,
      closedAt: event.at,
      days: dayWith(round, dateKey, (day) => ({
        ...day,
        touched: true,
        deferred: day.deferred || event.outcome === "deferred",
        abandoned: day.abandoned || event.outcome === "abandoned"
      }))
    });
  }

  const evidence: RecallEvidence =
    round.evidence === "assisted" || !event.memoryEligible
      ? "assisted"
      : "independent";
  const submissionCount = round.submissionCount + 1;
  const failureCount = round.failureCount + Number(!event.passed);
  const days = dayWith(round, dateKey, (day) => ({
    ...day,
    touched: true,
    submissions: day.submissions + 1,
    failures: day.failures + Number(!event.passed),
    independentAccepted:
      day.independentAccepted || (event.passed && evidence === "independent"),
    assistedAccepted:
      day.assistedAccepted || (event.passed && evidence === "assisted")
  }));

  return withEvent({
    evidence,
    submissionCount,
    failureCount,
    days,
    ...(event.passed
      ? {
          state: "completed" as const,
          completionEvidence: evidence,
          closedAt: event.at
        }
      : {})
  });
}

/** Applies one idempotent operation and returns a new history object. */
export function applyRecallRoundEvent(
  historyValue: unknown,
  rawEvent: RecallRoundEvent,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRoundHistory {
  const history = normalizeRecallRoundHistory(historyValue, maxRounds);
  const event = normalizeEvent(rawEvent);
  if (!event) return history;
  if (
    history.rounds.some((round) => round.eventIds.includes(event.eventId))
  ) {
    return history;
  }

  if (event.kind === "fsrs-write") {
    const dateKey = eventDateKey(event.at);
    const alreadyWrittenToday = history.rounds.some(
      (round) =>
        round.problemId === event.problemId &&
        (round.days[dateKey]?.fsrsWrites ?? 0) > 0
    );
    if (alreadyWrittenToday) return history;
  }

  if (event.kind === "start") {
    if (history.rounds.some((round) => round.id === event.roundId)) {
      return history;
    }
    const dateKey = eventDateKey(event.at);
    const evidence: RecallEvidence =
      event.assisted || event.mode === "repeat" ? "assisted" : "independent";
    const round: RecallRound = {
      version: RECALL_ROUND_VERSION,
      id: event.roundId,
      problemId: event.problemId,
      mode: event.mode,
      origin: event.origin,
      startedAt: event.at,
      updatedAt: event.at,
      state: "active",
      evidence,
      submissionCount: 0,
      failureCount: 0,
      resumeCount: 0,
      fsrsWriteCount: 0,
      days: {
        [dateKey]: { ...emptyDay(), touched: true }
      },
      eventIds: [event.eventId]
    };
    return capRecallRoundHistory(
      { version: RECALL_ROUND_VERSION, rounds: [round, ...history.rounds] },
      maxRounds
    );
  }

  const index = history.rounds.findIndex(
    (round) => round.id === event.roundId
  );
  if (index < 0) return history;
  const current = history.rounds[index];
  const next = applyToRound(current, event);
  if (next === current) return history;
  const rounds = history.rounds.slice();
  rounds[index] = next;
  return capRecallRoundHistory(
    { version: RECALL_ROUND_VERSION, rounds },
    maxRounds
  );
}

export function startRecallRound(
  history: unknown,
  event: Omit<RecallStartEvent, "kind">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRoundHistory {
  return applyRecallRoundEvent(history, { ...event, kind: "start" }, maxRounds);
}

export function markRecallRoundAssisted(
  history: unknown,
  event: Omit<RecallAssistanceEvent, "kind">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRoundHistory {
  return applyRecallRoundEvent(
    history,
    { ...event, kind: "assistance" },
    maxRounds
  );
}

export function recordRecallSubmission(
  history: unknown,
  event: Omit<RecallSubmissionEvent, "kind">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRoundHistory {
  return applyRecallRoundEvent(
    history,
    { ...event, kind: "submission" },
    maxRounds
  );
}

export function closeRecallRound(
  history: unknown,
  event: Omit<RecallCloseEvent, "kind">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRoundHistory {
  return applyRecallRoundEvent(history, { ...event, kind: "close" }, maxRounds);
}

export function resumeRecallRound(
  history: unknown,
  event: Omit<RecallResumeEvent, "kind">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRoundHistory {
  return applyRecallRoundEvent(history, { ...event, kind: "resume" }, maxRounds);
}

export function recordRecallFsrsWrite(
  history: unknown,
  event: Omit<RecallFsrsWriteEvent, "kind">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRoundHistory {
  return applyRecallRoundEvent(
    history,
    { ...event, kind: "fsrs-write" },
    maxRounds
  );
}

function roundsOnly(history: RecallRoundHistory): RecallRound[] {
  return history.rounds;
}

export interface RecallStartOrResumeInput
  extends Omit<RecallStartEvent, "kind" | "roundId"> {
  /** Used only when there is no active/deferred matching round. */
  roundId: string;
}

/**
 * Array-oriented integration API for PersistedState.recallRounds.
 *
 * - an active round for the same problem is reused without adding an event;
 * - the newest deferred round for the same problem and mode is resumed;
 * - otherwise a new round is started with input.roundId.
 *
 * A completed/abandoned round is never silently reopened. A mode change starts
 * a new round so its mode/origin snapshot remains truthful.
 */
export function startOrResumeRound(
  roundsValue: unknown,
  input: RecallStartOrResumeInput,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRound[] {
  const history = normalizeRecallRoundHistory(roundsValue, maxRounds);
  const problemId = cleanText(input.problemId, "", 200);
  const mode = normalizeMode(input.mode);
  if (!problemId) return history.rounds;

  const active = history.rounds.find(
    (round) =>
      round.problemId === problemId &&
      round.mode === mode &&
      round.state === "active"
  );
  if (active) {
    if (!input.assisted || active.evidence === "assisted") {
      return history.rounds;
    }
    return roundsOnly(
      markRecallRoundAssisted(
        history,
        {
          eventId: input.eventId,
          roundId: active.id,
          problemId,
          at: input.at
        },
        maxRounds
      )
    );
  }

  const deferred = history.rounds
    .filter(
      (round) =>
        round.problemId === problemId &&
        round.mode === mode &&
        round.state === "deferred"
    )
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )[0];
  if (deferred) {
    return roundsOnly(
      resumeRecallRound(
        history,
        {
          eventId: input.eventId,
          roundId: deferred.id,
          problemId,
          at: input.at
        },
        maxRounds
      )
    );
  }

  return roundsOnly(
    startRecallRound(
      history,
      {
        eventId: input.eventId,
        roundId: input.roundId,
        problemId,
        at: input.at,
        mode,
        origin: input.origin,
        assisted: input.assisted
      },
      maxRounds
    )
  );
}

/** Returns the active round callers should target for subsequent operations. */
export function activeRecallRound(
  roundsValue: unknown,
  problemId: string,
  mode?: RecallRoundMode
): RecallRound | undefined {
  const normalizedProblemId = cleanText(problemId, "", 200);
  return normalizeRecallRoundHistory(roundsValue).rounds.find(
    (round) =>
      round.problemId === normalizedProblemId &&
      round.state === "active" &&
      (mode === undefined || round.mode === normalizeMode(mode))
  );
}

/** PersistedState.recallRounds convenience wrapper. */
export function markAssisted(
  roundsValue: unknown,
  event: Omit<RecallAssistanceEvent, "kind">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRound[] {
  return roundsOnly(markRecallRoundAssisted(roundsValue, event, maxRounds));
}

/** PersistedState.recallRounds convenience wrapper. */
export function recordSubmission(
  roundsValue: unknown,
  event: Omit<RecallSubmissionEvent, "kind">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRound[] {
  return roundsOnly(recordRecallSubmission(roundsValue, event, maxRounds));
}

/** PersistedState.recallRounds convenience wrapper. */
export function closeRound(
  roundsValue: unknown,
  event: Omit<RecallCloseEvent, "kind">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRound[] {
  return roundsOnly(closeRecallRound(roundsValue, event, maxRounds));
}

export function deferRound(
  roundsValue: unknown,
  event: Omit<RecallCloseEvent, "kind" | "outcome">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRound[] {
  return closeRound(roundsValue, { ...event, outcome: "deferred" }, maxRounds);
}

export function abandonRound(
  roundsValue: unknown,
  event: Omit<RecallCloseEvent, "kind" | "outcome">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRound[] {
  return closeRound(roundsValue, { ...event, outcome: "abandoned" }, maxRounds);
}

/** PersistedState.recallRounds convenience wrapper. */
export function recordFsrsWrite(
  roundsValue: unknown,
  event: Omit<RecallFsrsWriteEvent, "kind">,
  maxRounds = MAX_RECALL_ROUND_HISTORY
): RecallRound[] {
  return roundsOnly(recordRecallFsrsWrite(roundsValue, event, maxRounds));
}

/** Derives exact daily problem sets; no queue length is used as completion. */
export function summarizeRecallDay(
  historyValue: unknown,
  date: Date | number | string = new Date()
): RecallDailySummary {
  const history = normalizeRecallRoundHistory(historyValue);
  const dateKey =
    typeof date === "string" && DATE_KEY_PATTERN.test(date)
      ? date
      : recallStudyDateKey(date);
  const touchedProblemIds = new Set<string>();
  const independentCompletedProblemIds = new Set<string>();
  const assistedCompletedProblemIds = new Set<string>();
  const deferredProblemIds = new Set<string>();
  const abandonedProblemIds = new Set<string>();
  const fsrsProblemIds = new Set<string>();
  let submissions = 0;
  let failures = 0;
  let fsrsWrites = 0;

  for (const round of history.rounds) {
    const day = round.days[dateKey];
    if (!day) continue;
    if (day.touched) touchedProblemIds.add(round.problemId);
    if (day.independentAccepted) {
      independentCompletedProblemIds.add(round.problemId);
    }
    if (day.assistedAccepted) assistedCompletedProblemIds.add(round.problemId);
    if (day.deferred) deferredProblemIds.add(round.problemId);
    if (day.abandoned) abandonedProblemIds.add(round.problemId);
    if (day.fsrsWrites > 0) fsrsProblemIds.add(round.problemId);
    submissions += day.submissions;
    failures += day.failures;
    fsrsWrites += day.fsrsWrites;
  }

  const completedProblemIds = new Set([
    ...independentCompletedProblemIds,
    ...assistedCompletedProblemIds
  ]);
  const unfinishedProblemIds = new Set(
    [...touchedProblemIds].filter((problemId) => !completedProblemIds.has(problemId))
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

/** Short array-oriented alias used by the workspace/dashboard integration. */
export const summarizeDaily = summarizeRecallDay;
