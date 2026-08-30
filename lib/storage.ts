import type {
  AttemptTimerState,
  DailyActivity,
  PersistedState,
  SubmissionEvent,
  StudyRecord,
  StudyStatus,
  TestResult
} from "@/lib/types";
import {
  emptyAttemptTimer,
  normalizeAttemptTimer
} from "./attemptTimer.ts";
import {
  DEFAULT_SPEED_QUESTION_SECONDS,
  emptySpeedSession,
  normalizeSpeedQuestionSeconds,
  normalizeSpeedSession,
  speedQuestionLimitMs
} from "./speedMode.ts";
import {
  emptyRepeatSession,
  normalizeRepeatSession
} from "./repeatMode.ts";
import {
  rebuildMemoryCards
} from "./memoryEvidence.ts";
import {
  emptyTrainingProgram,
  normalizeTrainingProgram
} from "./trainingPlan.ts";
import {
  capRecallRoundHistory,
  normalizeRecallRoundHistory,
  recallStudyDateKey
} from "./recallRound.ts";

const STORAGE_KEY = "recode-recall:v3";
export const CURRENT_STATE_VERSION = 6 as const;
// v5 已經完成記憶證據與可恢復 session 的資料遷移。之後新增欄位時
// 不能再拿 CURRENT_STATE_VERSION 當破壞性重建門檻，否則每次升版都會
// 清空目前工作階段並重播 FSRS。
const MEMORY_EVIDENCE_SCHEMA_VERSION = 5;
const RESTORABLE_SESSION_SCHEMA_VERSION = 5;
export const CURRENT_SYNC_PROTOCOL_VERSION = 2 as const;
export const LOCAL_UPDATED_AT_KEY = "recode-recall:last-saved-at";
const LOCAL_SNAPSHOT_FORMAT = "recode-local-snapshot-v1";
export const LOCAL_SNAPSHOT_MAX_BYTES = 3_000_000;
export const LOCAL_SNAPSHOT_HISTORY_LIMIT = 500;
export const LOCAL_SNAPSHOT_FULL_EVENT_LIMIT = 50;
// Older key names, newest first. They are only ever read, so a browser that
// still holds progress under a previous name keeps it.
const PREVIOUS_STORAGE_KEYS = [
  "recode-leetcode-recall:v3",
  "rex-leetcode-recall:v3",
  "rex-leetcode-recall:v2"
];
const PREVIOUS_UPDATED_AT_KEYS = [
  "recode-leetcode-recall:last-saved-at",
  "rex-leetcode-recall:last-saved-at"
];
let lastStateSaveTimestamp = 0;

export function nextStateSaveTimestamp(now = Date.now()): number {
  lastStateSaveTimestamp = Math.max(
    Math.floor(now),
    lastStateSaveTimestamp + 1
  );
  return lastStateSaveTimestamp;
}

export const EMPTY_STATE: PersistedState = {
  version: CURRENT_STATE_VERSION,
  drafts: {},
  notes: {},
  records: {},
  customTests: {},
  activity: {},
  submissionHistory: [],
  recallRounds: [],
  training: emptyTrainingProgram(),
  session: {
    queue: [],
    backHistory: [],
    results: [],
    submitted: false,
    initialTotal: 0,
    problemTimer: emptyAttemptTimer(),
    attempted: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    totalMs: 0,
    speed: emptySpeedSession(),
    repeat: emptyRepeatSession()
  },
  settings: {
    filterOpen: false,
    answerOpen: false,
    answerReferenceOpen: false,
    explanationOpen: false,
    statsOpen: false,
    errorsOpen: false,
    libraryOpen: false,
    sidebarOpen: false,
    adaptiveAnswerFade: true,
    answerRevealMode: "full",
    answerRevealPercent: 30,
    answerBrightness: 11,
    editorHeight: 520,
    leftPercent: 45,
    language: "zh",
    mode: "guided",
    sessionSize: 20,
    speedAnswerVisible: false,
    // 與 speedMode 的預設一致（刷題一題 300 秒），避免新使用者拿到舊的 60 秒。
    speedQuestionSeconds: DEFAULT_SPEED_QUESTION_SECONDS,
    formatOnSubmit: false,
    interviewMinutes: 45,
    randomOrder: false,
    filters: {
      query: "",
      category: "all",
      source: "all",
      difficulty: "all",
      status: "all"
    }
  }
};

export function localDateKey(value: Date | number | string = new Date()): string {
  return recallStudyDateKey(value);
}

function migrateActivity(
  records: Record<string, StudyRecord>,
  storedActivity?: Record<string, DailyActivity>
): Record<string, DailyActivity> {
  if (storedActivity && Object.keys(storedActivity).length > 0) {
    return storedActivity;
  }

  const activity: Record<string, DailyActivity> = {};
  for (const record of Object.values(records)) {
    if (!record.lastStudiedAt || !record.attempts) continue;
    const key = localDateKey(record.lastStudiedAt);
    const previous = activity[key] ?? {
      submissions: 0,
      passed: 0,
      failed: 0,
      totalMs: 0
    };
    activity[key] = {
      submissions: previous.submissions + record.attempts,
      passed: previous.passed + record.passed,
      failed: previous.failed + record.failed,
      totalMs: previous.totalMs + record.totalMs
    };
  }
  return activity;
}

function normalizeTestResults(value: unknown): TestResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (result): result is TestResult =>
        typeof result === "object" &&
        result !== null &&
        typeof (result as TestResult).name === "string" &&
        typeof (result as TestResult).passed === "boolean"
    )
    .map((result) => ({
      name: result.name,
      passed: result.passed,
      ...(typeof result.errorType === "string"
        ? { errorType: result.errorType }
        : {}),
      ...(typeof result.input === "string" ? { input: result.input } : {}),
      ...(typeof result.actual === "string" ? { actual: result.actual } : {}),
      ...(typeof result.expected === "string"
        ? { expected: result.expected }
        : {}),
      ...(typeof result.error === "string" ? { error: result.error } : {}),
      ...(typeof result.stdout === "string" ? { stdout: result.stdout } : {})
    }));
}

function normalizeSubmissionHistory(value: unknown): SubmissionEvent[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is SubmissionEvent =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as SubmissionEvent).id === "string" &&
        typeof (item as SubmissionEvent).problemId === "string" &&
        typeof (item as SubmissionEvent).submittedAt === "string" &&
        typeof (item as SubmissionEvent).passed === "boolean" &&
        Number.isFinite((item as SubmissionEvent).durationMs)
    )
    .map((item) => ({
      id: item.id,
      ...(typeof item.roundId === "string" && item.roundId.trim()
        ? { roundId: item.roundId.trim().slice(0, 200) }
        : {}),
      problemId: item.problemId,
      submittedAt: item.submittedAt,
      passed: item.passed,
      durationMs: item.durationMs,
      ...(Number.isFinite(item.hintsUsed)
        ? { hintsUsed: Math.max(0, Number(item.hintsUsed)) }
        : {}),
      ...(Number.isFinite(item.insertedChars)
        ? { insertedChars: Math.max(0, Number(item.insertedChars)) }
        : {}),
      ...(Number.isFinite(item.deletedChars)
        ? { deletedChars: Math.max(0, Number(item.deletedChars)) }
        : {}),
      ...(Number.isFinite(item.editOperations)
        ? { editOperations: Math.max(0, Number(item.editOperations)) }
        : {}),
      ...(Number.isFinite(item.resetCount)
        ? { resetCount: Math.max(0, Number(item.resetCount)) }
        : {}),
      ...(Number.isFinite(item.answerRevealCount)
        ? {
            answerRevealCount: Math.max(
              0,
              Number(item.answerRevealCount)
            )
          }
        : {}),
      ...(Number.isFinite(item.reviewStruggleScore)
        ? {
            reviewStruggleScore: Math.max(
              0,
              Number(item.reviewStruggleScore)
            )
          }
        : {}),
      ...(Number.isFinite(item.timeRatio)
        ? { timeRatio: Math.max(0, Number(item.timeRatio)) }
        : {}),
      ...(Number.isFinite(item.rewriteRatio)
        ? { rewriteRatio: Math.max(0, Number(item.rewriteRatio)) }
        : {}),
      ...(Number.isFinite(item.predictedRecall)
        ? {
            predictedRecall: Math.min(
              1,
              Math.max(0, Number(item.predictedRecall))
            )
          }
        : {}),
      ...(Number.isFinite(item.calibrationSampleSize)
        ? {
            calibrationSampleSize: Math.max(
              0,
              Math.floor(Number(item.calibrationSampleSize))
            )
          }
        : {}),
      ...(Number.isFinite(item.calibrationBias)
        ? {
            calibrationBias: Math.min(
              1,
              Math.max(-1, Number(item.calibrationBias))
            )
          }
        : {}),
      ...(item.inferredRating === "again" ||
      item.inferredRating === "hard" ||
      item.inferredRating === "good" ||
      item.inferredRating === "easy"
        ? { inferredRating: item.inferredRating }
        : {}),
      ...(item.practiceMode === "guided" ||
      item.practiceMode === "free" ||
      item.practiceMode === "explore" ||
      item.practiceMode === "interview" ||
      item.practiceMode === "speed" ||
      item.practiceMode === "repeat"
        ? { practiceMode: item.practiceMode }
        : {}),
      ...(item.reviewOrigin === "new" ||
      item.reviewOrigin === "retry" ||
      item.reviewOrigin === "fsrs-due" ||
      item.reviewOrigin === "checkpoint-due" ||
      item.reviewOrigin === "early" ||
      item.reviewOrigin === "manual" ||
      item.reviewOrigin === "same-session"
        ? { reviewOrigin: item.reviewOrigin }
        : {}),
      ...(typeof item.memoryEligible === "boolean"
        ? { memoryEligible: item.memoryEligible }
        : Number(item.answerRevealCount) > 0
          ? { memoryEligible: false }
          : {}),
      ...(item.memoryEvidenceReason === "independent-recall" ||
      item.memoryEvidenceReason === "answer-assisted" ||
      item.memoryEvidenceReason === "repeat-guided" ||
      item.memoryEvidenceReason === "speed-answer-visible" ||
      item.memoryEvidenceReason === "speed-timeout-rewrite" ||
      item.memoryEvidenceReason === "speed-late-submit" ||
      item.memoryEvidenceReason === "early-review" ||
      item.memoryEvidenceReason === "same-session-repeat" ||
      item.memoryEvidenceReason === "manual-review" ||
      item.memoryEvidenceReason === "legacy-assisted"
        ? { memoryEvidenceReason: item.memoryEvidenceReason }
        : typeof item.memoryEligible !== "boolean" &&
            Number(item.answerRevealCount) > 0
          ? { memoryEvidenceReason: "legacy-assisted" as const }
          : {}),
      ...(typeof item.code === "string" ? { code: item.code } : {}),
      ...(Array.isArray(item.results)
        ? { results: normalizeTestResults(item.results) }
        : {})
    }))
    .slice(0, 20_000);
}

function normalizeIdList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const id = candidate.trim().slice(0, 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, text]) => key.length > 0 && typeof text === "string"
    )
  );
}

interface LocalSnapshotEnvelope {
  format: typeof LOCAL_SNAPSHOT_FORMAT;
  protocolVersion: typeof CURRENT_SYNC_PROTOCOL_VERSION;
  partial: boolean;
  state: PersistedState;
}

function parseLocalSnapshot(raw: string | null): {
  state: PersistedState;
  partial: boolean;
  protocolVersion: number;
} {
  if (raw === null) throw new Error("missing local snapshot");
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as Partial<LocalSnapshotEnvelope>).format ===
      LOCAL_SNAPSHOT_FORMAT
  ) {
    const envelope = parsed as LocalSnapshotEnvelope;
    return {
      state: normalizeState(envelope.state),
      partial: Boolean(envelope.partial),
      protocolVersion: Number(envelope.protocolVersion) || 0
    };
  }
  return {
    state: normalizeState(parsed),
    partial: false,
    protocolVersion: 0
  };
}

function serializedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function fitsWithinBytes(value: string, maxBytes: number): boolean {
  // UTF-8 中一個 UTF-16 code unit 最多佔 3 bytes（BMP 字元 ≤ 3 bytes；
  // surrogate pair 兩個 code unit 合計 4 bytes，更省）。因此
  // value.length * 3 是「保守上界」：上界未超標就必定未超標，絕不會
  // 漏判超標。只有可能超標時才逐位元組精確計算，避免每次草稿變更
  // 都對整份狀態跑 TextEncoder.encode。
  if (value.length * 3 < maxBytes) return true;
  return serializedBytes(value) <= maxBytes;
}

function compactSubmission(
  event: SubmissionEvent,
  keepDetails: boolean
): SubmissionEvent {
  if (keepDetails) return event;
  const { code: _code, results: _results, ...summary } = event;
  return summary;
}

export function serializeLocalSnapshot(
  state: PersistedState,
  maxBytes = LOCAL_SNAPSHOT_MAX_BYTES
): string {
  const fullEnvelope: LocalSnapshotEnvelope = {
    format: LOCAL_SNAPSHOT_FORMAT,
    protocolVersion: CURRENT_SYNC_PROTOCOL_VERSION,
    partial: false,
    state
  };
  const full = JSON.stringify(fullEnvelope);
  if (fitsWithinBytes(full, maxBytes)) return full;

  const compactState: PersistedState = {
    ...state,
    recallRounds: capRecallRoundHistory(
      { version: 1, rounds: state.recallRounds },
      1_000
    ).rounds,
    submissionHistory: state.submissionHistory
      .slice(0, LOCAL_SNAPSHOT_HISTORY_LIMIT)
      .map((event, index) =>
        compactSubmission(
          event,
          index < LOCAL_SNAPSHOT_FULL_EVENT_LIMIT
        )
      )
  };
  const compactEnvelope: LocalSnapshotEnvelope = {
    format: LOCAL_SNAPSHOT_FORMAT,
    protocolVersion: CURRENT_SYNC_PROTOCOL_VERSION,
    partial: true,
    state: compactState
  };
  const compact = JSON.stringify(compactEnvelope);
  if (fitsWithinBytes(compact, maxBytes)) return compact;

  // 最後一道瀏覽器備援只保留最近 100 筆摘要。完整歷史仍在 SQLite；
  // partial 標記可阻止這份精簡快照反向覆蓋完整資料庫。
  compactEnvelope.state = {
    ...compactState,
    recallRounds: capRecallRoundHistory(
      { version: 1, rounds: state.recallRounds },
      250
    ).rounds,
    submissionHistory: state.submissionHistory
      .slice(0, 100)
      .map((event) => compactSubmission(event, false))
  };
  return JSON.stringify(compactEnvelope);
}

export function loadState(): PersistedState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      PREVIOUS_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(
        (stored) => stored !== null
      );
    return parseLocalSnapshot(raw ?? null).state;
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

export function normalizeState(value: unknown): PersistedState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return structuredClone(EMPTY_STATE);
  }

  const parsed = value as Partial<PersistedState>;
  const storedVersion = Number(parsed.version) || 0;
  const rawRecords = parsed.records ?? {};
  const submissionHistory = normalizeSubmissionHistory(
    parsed.submissionHistory
  );
  const records =
    storedVersion < MEMORY_EVIDENCE_SCHEMA_VERSION
      ? rebuildMemoryCards(rawRecords, submissionHistory).records
      : rawRecords;
  const restoredQueue = normalizeIdList(parsed.session?.queue, 10_000);
  const isFirstSidebarLoad =
    typeof parsed.settings?.sidebarOpen !== "boolean";
  const legacySettings = parsed.settings as
    | (Partial<PersistedState["settings"]> & { starredOpen?: boolean })
    | undefined;

  return {
    ...structuredClone(EMPTY_STATE),
    ...parsed,
    version: CURRENT_STATE_VERSION,
    drafts: normalizeStringMap(parsed.drafts),
    notes: normalizeStringMap(parsed.notes),
    records,
    customTests: parsed.customTests ?? {},
    activity: migrateActivity(records, parsed.activity),
    submissionHistory,
    recallRounds: normalizeRecallRoundHistory(
      (parsed as Partial<PersistedState>).recallRounds
    ).rounds,
    training: normalizeTrainingProgram(parsed.training),
    session:
      storedVersion < RESTORABLE_SESSION_SCHEMA_VERSION
        ? structuredClone(EMPTY_STATE.session)
        : {
            ...EMPTY_STATE.session,
            ...(parsed.session ?? {}),
            queue: restoredQueue,
            backHistory: normalizeIdList(
              parsed.session?.backHistory,
              100
            ).slice(-100),
            currentProblemId: restoredQueue[0],
            results: normalizeTestResults(parsed.session?.results),
            submitted:
              typeof parsed.session?.submitted === "boolean"
                ? parsed.session.submitted
                : false,
            problemTimer: normalizeAttemptTimer(
              parsed.session?.problemTimer as AttemptTimerState | undefined
            ),
            speed: normalizeSpeedSession(
              parsed.session?.speed,
              speedQuestionLimitMs(
                parsed.settings?.speedQuestionSeconds
              )
            ),
            repeat: normalizeRepeatSession(
              parsed.session?.repeat
            )
          },
    settings: {
      ...EMPTY_STATE.settings,
      ...(parsed.settings ?? {}),
      ...(isFirstSidebarLoad
        ? {
            filterOpen: false,
            statsOpen: false,
            errorsOpen: false,
            libraryOpen: false,
            sidebarOpen: false
          }
        : {}),
      errorsOpen:
        typeof parsed.settings?.errorsOpen === "boolean"
          ? parsed.settings.errorsOpen
          : false,
      libraryOpen:
        typeof parsed.settings?.libraryOpen === "boolean"
          ? parsed.settings.libraryOpen
          : Boolean(legacySettings?.starredOpen),
      adaptiveAnswerFade:
        typeof parsed.settings?.adaptiveAnswerFade === "boolean"
          ? parsed.settings.adaptiveAnswerFade
          : true,
      answerRevealMode:
        parsed.settings?.answerRevealMode === "random" ? "random" : "full",
      mode:
        storedVersion < RESTORABLE_SESSION_SCHEMA_VERSION
          ? "guided"
          : parsed.settings?.mode === "guided" ||
              parsed.settings?.mode === "free" ||
              parsed.settings?.mode === "explore" ||
              parsed.settings?.mode === "interview" ||
              parsed.settings?.mode === "speed" ||
              parsed.settings?.mode === "repeat"
            ? parsed.settings.mode
            : "guided",
      answerOpen:
        storedVersion < RESTORABLE_SESSION_SCHEMA_VERSION
          ? false
          : typeof parsed.settings?.answerOpen === "boolean"
            ? parsed.settings.answerOpen
            : EMPTY_STATE.settings.answerOpen,
      answerReferenceOpen:
        storedVersion < RESTORABLE_SESSION_SCHEMA_VERSION
          ? false
          : typeof parsed.settings?.answerReferenceOpen === "boolean"
            ? parsed.settings.answerReferenceOpen
            : EMPTY_STATE.settings.answerReferenceOpen,
      explanationOpen:
        storedVersion < RESTORABLE_SESSION_SCHEMA_VERSION
          ? false
          : typeof parsed.settings?.explanationOpen === "boolean"
            ? parsed.settings.explanationOpen
            : EMPTY_STATE.settings.explanationOpen,
      speedAnswerVisible:
        typeof parsed.settings?.speedAnswerVisible === "boolean"
          ? parsed.settings.speedAnswerVisible
          : false,
      speedQuestionSeconds: normalizeSpeedQuestionSeconds(
        parsed.settings?.speedQuestionSeconds
      ),
      formatOnSubmit:
        typeof parsed.settings?.formatOnSubmit === "boolean"
          ? parsed.settings.formatOnSubmit
          : false,
      interviewMinutes: [30, 45, 60].includes(
        Number(parsed.settings?.interviewMinutes)
      )
        ? Number(parsed.settings?.interviewMinutes)
        : 45,
      randomOrder:
        typeof parsed.settings?.randomOrder === "boolean"
          ? parsed.settings.randomOrder
          : false,
      filters: {
        query:
          typeof parsed.settings?.filters?.query === "string"
            ? parsed.settings.filters.query
            : "",
        category:
          typeof parsed.settings?.filters?.category === "string"
            ? parsed.settings.filters.category
            : "all",
        source:
          typeof parsed.settings?.filters?.source === "string"
            ? parsed.settings.filters.source
            : "all",
        difficulty:
          parsed.settings?.filters?.difficulty === "easy" ||
          parsed.settings?.filters?.difficulty === "medium" ||
          parsed.settings?.filters?.difficulty === "hard" ||
          parsed.settings?.filters?.difficulty === "unknown" ||
          parsed.settings?.filters?.difficulty === "easy-medium" ||
          parsed.settings?.filters?.difficulty === "medium-hard" ||
          parsed.settings?.filters?.difficulty === "known"
            ? parsed.settings.filters.difficulty
            : "all",
        status:
          parsed.settings?.filters?.status === "new" ||
          parsed.settings?.filters?.status === "learning" ||
          parsed.settings?.filters?.status === "retry" ||
          parsed.settings?.filters?.status === "completed" ||
          parsed.settings?.filters?.status === "mastered" ||
          parsed.settings?.filters?.status === "due" ||
          parsed.settings?.filters?.status === "starred" ||
          parsed.settings?.filters?.status === "solved"
            ? parsed.settings.filters.status
            : "all"
      },
      answerRevealPercent: Math.min(
        100,
        Math.max(
          10,
          Math.round(
            (Number(parsed.settings?.answerRevealPercent) || 30) / 10
          ) * 10
        )
      ),
      answerBrightness: Math.min(
        100,
        Math.max(
          5,
          Math.round(
            Number(parsed.settings?.answerBrightness) ||
              EMPTY_STATE.settings.answerBrightness
          )
        )
      ),
      editorHeight: Math.min(
        1000,
        Math.max(300, Number(parsed.settings?.editorHeight) || 520)
      )
    }
  };
}

// localStorage 快照寫入節流：草稿每次變更（350ms debounce）都會觸發
// saveState，大狀態的 JSON.stringify + setItem 會造成打字週期性頓挫。
// 這裡做 trailing throttle：每個間隔內最多實際寫入一次；間隔內的呼叫
// 會記住「最後一版」pending 快照，時間到由 timer 補寫，不會漏掉最終狀態。
//
// 資料安全語意照舊：
// - 崩潰備援：頁面卸載/隱藏（beforeunload / pagehide /
//   visibilitychange→hidden）時進入 flush 模式——先補寫 pending，且此後
//   同一次事件派發中的任何 saveState 呼叫（StudyWorkspace 的 flush
//   handler 會帶著最新編輯內容呼叫）都立即同步寫入，不受節流影響。
//   本模組的監聽器在 import 時註冊，必然早於元件在 effect 中註冊的
//   flush handler，因此 flush 模式一定先於呼叫端的 saveState 生效。
// - 多分頁租約：延遲補寫是節流才引入的新路徑；補寫前檢查
//   LOCAL_UPDATED_AT_KEY，若其他分頁（租約交接後的新主分頁）已寫入
//   較新的快照，就放棄這筆過期補寫，避免舊資料覆蓋新資料。
// - SQLite 儲存路徑完全不經過這裡，不受影響。
const LOCAL_SNAPSHOT_WRITE_INTERVAL_MS = 2_000;
let localSnapshotFlushMode = false;
let lastLocalSnapshotWriteAt = 0;
let pendingLocalSnapshot:
  | { state: PersistedState; savedAt: number }
  | null = null;
let pendingLocalSnapshotTimer:
  | ReturnType<typeof setTimeout>
  | null = null;

function writeLocalSnapshot(
  state: PersistedState,
  savedAt: number
): void {
  lastLocalSnapshotWriteAt = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, serializeLocalSnapshot(state));
    localStorage.setItem(LOCAL_UPDATED_AT_KEY, String(savedAt));
  } catch {
    // SQLite 是主要儲存；瀏覽器 quota 不足時不可讓編輯器因備援失敗而
    // 中斷。下一次 SQLite 寫入仍會保存完整狀態。
  }
}

function clearPendingLocalSnapshotTimer(): void {
  if (pendingLocalSnapshotTimer !== null) {
    clearTimeout(pendingLocalSnapshotTimer);
    pendingLocalSnapshotTimer = null;
  }
}

function writePendingLocalSnapshot(): void {
  clearPendingLocalSnapshotTimer();
  const pending = pendingLocalSnapshot;
  pendingLocalSnapshot = null;
  if (!pending) return;
  try {
    const existingUpdatedAt =
      Number(localStorage.getItem(LOCAL_UPDATED_AT_KEY)) || 0;
    // 節流前的行為是「呼叫當下同步寫入」，不存在延遲寫；因此任何
    // 延遲補寫都必須確認沒有其他分頁在等待期間寫入更新的快照，
    // 否則會用舊資料蓋掉新主分頁的資料。已過期就直接放棄。
    if (existingUpdatedAt > pending.savedAt) return;
  } catch {
    // 讀不到時間戳就照常補寫，與原本無條件寫入的行為一致。
  }
  writeLocalSnapshot(pending.state, pending.savedAt);
}

if (typeof window !== "undefined") {
  const enterLocalSnapshotFlushMode = () => {
    localSnapshotFlushMode = true;
    writePendingLocalSnapshot();
    // beforeunload 可能被使用者取消（頁面沒有真的關閉）。留在前景時
    // 於下一個 task 解除 flush 模式、恢復節流；真正卸載時這個 timer
    // 不會有機會執行，不影響落盤。
    setTimeout(() => {
      if (document.visibilityState === "visible") {
        localSnapshotFlushMode = false;
      }
    }, 0);
  };
  window.addEventListener("beforeunload", enterLocalSnapshotFlushMode);
  window.addEventListener("pagehide", enterLocalSnapshotFlushMode);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      enterLocalSnapshotFlushMode();
    } else {
      localSnapshotFlushMode = false;
    }
  });
}

export function saveState(
  state: PersistedState,
  savedAt = Date.now()
): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (
    localSnapshotFlushMode ||
    now - lastLocalSnapshotWriteAt >= LOCAL_SNAPSHOT_WRITE_INTERVAL_MS
  ) {
    // leading edge（距上次實際寫入已滿一個間隔）或 flush 模式：立即
    // 同步寫入。本次 state 一定比 pending 新（同分頁 savedAt 單調遞增），
    // 丟棄 pending 等同原本「後寫覆蓋先寫」的結果。
    clearPendingLocalSnapshotTimer();
    pendingLocalSnapshot = null;
    writeLocalSnapshot(state, savedAt);
    return;
  }
  pendingLocalSnapshot = { state, savedAt };
  if (pendingLocalSnapshotTimer === null) {
    pendingLocalSnapshotTimer = setTimeout(
      writePendingLocalSnapshot,
      Math.min(
        LOCAL_SNAPSHOT_WRITE_INTERVAL_MS,
        Math.max(
          0,
          lastLocalSnapshotWriteAt +
            LOCAL_SNAPSHOT_WRITE_INTERVAL_MS -
            now
        )
      )
    );
  }
}

export function editorCodeForDraft(
  savedDraft: string | undefined,
  starter: string
): string {
  if (!savedDraft?.trim()) return starter;

  const meaningfulLines = savedDraft
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const isOldEmptySkeleton =
    meaningfulLines.length > 0 &&
    meaningfulLines.every((line) =>
      /^(?:@\w+|class\s+|(?:async\s+)?def\s+)/.test(line)
    );

  return isOldEmptySkeleton ? starter : savedDraft;
}

export function loadLocalSnapshot(): {
  state: PersistedState;
  updatedAt: number;
  valid: boolean;
  partial: boolean;
  protocolVersion: number;
} {
  if (typeof window === "undefined") {
    return {
      state: structuredClone(EMPTY_STATE),
      updatedAt: 0,
      valid: false,
      partial: false,
      protocolVersion: 0
    };
  }
  const raw =
    localStorage.getItem(STORAGE_KEY) ??
    PREVIOUS_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(
      (stored) => stored !== null
    ) ??
    null;
  const updatedAt = Number(
    localStorage.getItem(LOCAL_UPDATED_AT_KEY) ??
      PREVIOUS_UPDATED_AT_KEYS.map((key) => localStorage.getItem(key)).find(
        (stored) => stored !== null
      ) ??
      0
  );
  try {
    const parsed = parseLocalSnapshot(raw);
    return {
      state: parsed.state,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      valid: true,
      partial: parsed.partial,
      protocolVersion: parsed.protocolVersion
    };
  } catch {
    return {
      state: structuredClone(EMPTY_STATE),
      updatedAt: 0,
      valid: false,
      partial: false,
      protocolVersion: 0
    };
  }
}

function stateDataScore(state: PersistedState): number {
  const recordScore = Object.values(state.records).reduce(
    (total, record) =>
      total +
      record.attempts +
      record.passed +
      record.failed +
      record.hints +
      (record.starred ? 1 : 0),
    0
  );
  const draftScore = Object.values(state.drafts).filter(
    (draft) => draft.trim().length > 0
  ).length;
  const noteScore = Object.values(state.notes).filter(
    (note) => note.trim().length > 0
  ).length;
  const customTestScore = Object.values(state.customTests).reduce(
    (total, tests) => total + tests.length,
    0
  );
  const activityScore = Object.values(state.activity).reduce(
    (total, day) => total + day.submissions,
    0
  );
  return (
    recordScore +
    draftScore +
    noteScore +
    customTestScore +
    activityScore +
    state.submissionHistory.length
  );
}

export function shouldUseLocalSnapshot(
  local: {
    state: PersistedState;
    updatedAt: number;
    valid?: boolean;
    partial?: boolean;
    protocolVersion?: number;
  },
  stored: { state: PersistedState; updatedAt: number } | null
): boolean {
  if (!stored) return true;
  if (local.valid === false) return false;
  if (local.partial) return false;
  if (
    local.protocolVersion !== undefined &&
    local.protocolVersion < CURRENT_SYNC_PROTOCOL_VERSION
  ) {
    return false;
  }
  if (local.updatedAt > stored.updatedAt) return true;

  // Old localStorage records did not have a timestamp. During the first
  // SQLite migration, preserve whichever side contains more real progress.
  return (
    local.updatedAt === 0 &&
    stateDataScore(local.state) > stateDataScore(stored.state)
  );
}

async function databaseError(response: Response): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: string };
    return new Error(payload.error ?? `資料庫 API 錯誤：${response.status}`);
  } catch {
    return new Error(`資料庫 API 錯誤：${response.status}`);
  }
}

export async function loadStateFromDatabase(): Promise<{
  state: PersistedState;
  updatedAt: number;
} | null> {
  const response = await fetch("/api/state", {
    cache: "no-store"
  });
  if (!response.ok) throw await databaseError(response);

  const payload = (await response.json()) as {
    state?: unknown;
    updatedAt?: string | null;
  };
  if (!payload.state) return null;
  const updatedAt = Date.parse(payload.updatedAt ?? "");
  return {
    state: normalizeState(payload.state),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0
  };
}

export async function saveStateToDatabase(
  state: PersistedState,
  keepalive = false,
  savedAt = nextStateSaveTimestamp()
): Promise<void> {
  const response = await fetch("/api/state", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Recode-Sync-Protocol": String(CURRENT_SYNC_PROTOCOL_VERSION)
    },
    body: JSON.stringify({ state, savedAt }),
    keepalive
  });
  if (!response.ok) throw await databaseError(response);

  // 伺服器端的 upsert 帶有 updated_at 比較條件：時間戳相等或較舊時
  // 會靜默拒寫，HTTP 仍回 200 但 applied 為 false。只檢查 response.ok
  // 會把「沒寫進去」當成儲存成功，UI 顯示已儲存、實際資料未落地。
  // 因此必須解析回應，applied === false 時走既有的 throw 錯誤路徑，
  // 讓呼叫端知道未落地並觸發既有的重試／提示機制。
  let payload: { applied?: boolean } | null = null;
  try {
    payload = (await response.json()) as { applied?: boolean };
  } catch {
    // 回應不是 JSON（例如 keepalive 寫入時頁面已卸載）：無法判讀
    // applied，維持原本視為成功的行為，避免誤報。
    payload = null;
  }
  if (payload?.applied === false) {
    throw new Error(
      "資料庫已有較新版本，本次變更未寫入；請重新整理頁面後再試"
    );
  }
}

export function defaultRecord(): StudyRecord {
  return {
    status: "new",
    attempts: 0,
    passed: 0,
    memoryPassed: 0,
    assistedPassed: 0,
    failed: 0,
    hints: 0,
    streak: 0,
    totalMs: 0
  };
}

export function labelForStatus(status: StudyStatus): string {
  return {
    new: "未開始",
    learning: "嘗試中",
    retry: "需要重刷",
    completed: "已完成",
    mastered: "已掌握"
  }[status];
}
