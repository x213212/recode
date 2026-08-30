import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const directory = mkdtempSync(join(tmpdir(), "recode-db-test-"));
process.env.RECODE_DB_PATH = join(directory, "state.sqlite3");

const {
  closeDatabaseForTests,
  exportDatabase,
  readStoredSnapshot,
  restoreDatabase,
  selectDatabaseFile,
  writeStoredState,
  writeStoredStateIfNewer
} = await import("../lib/database.ts");
const {
  CURRENT_STATE_VERSION,
  editorCodeForDraft,
  normalizeState,
  serializeLocalSnapshot,
  shouldUseLocalSnapshot
} = await import("../lib/storage.ts");

const state = {
  version: 5,
  drafts: { "0001": "return 1" },
  notes: {
    "0001": "## 我的推理\n\n用 `set` 記錄看過的值。"
  },
  records: {
    "0001": {
      status: "completed",
      attempts: 1,
      passed: 1,
      failed: 0,
      hints: 0,
      streak: 1,
      totalMs: 5000
    }
  },
  customTests: {},
  activity: {},
  submissionHistory: [
    {
      id: "submission-1",
      problemId: "0001",
      submittedAt: "2026-07-25T08:00:00.000Z",
      passed: true,
      durationMs: 5000,
      hintsUsed: 1,
      insertedChars: 240,
      deletedChars: 80,
      editOperations: 20,
      resetCount: 1,
      answerRevealCount: 1,
      reviewStruggleScore: 4.5,
      timeRatio: 0.8,
      rewriteRatio: 0.33,
      inferredRating: "hard",
      code: "class Solution:\\n    return 1",
      results: [{ name: "範例 1", passed: true }]
    }
  ],
  session: {
    queue: ["0001"],
    backHistory: ["0002"],
    currentProblemId: "0001",
    results: [
      {
        name: "範例 1",
        passed: false,
        errorType: "Wrong Answer",
        actual: "1",
        expected: "2"
      }
    ],
    submitted: true,
    initialTotal: 1,
    attempted: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
    totalMs: 5000
  },
  training: {
    preset: "standard",
    startedOn: "2026-07-27",
    completedDays: {},
    activePlan: {
      id: "training-db-test",
      date: "2026-07-27",
      planDay: 1,
      phase: "foundation",
      focusCategories: ["陣列與 Hash"],
      preset: "standard",
      estimatedMinutes: 120,
      status: "paused",
      activeBlockIndex: 0,
      blocks: [
        {
          id: "learn-0001",
          kind: "learn",
          mode: "free",
          title: "今日主題",
          purpose: "測試每日菜單可完整保存。",
          targetCount: 1,
          problemIds: ["0001"],
          remainingProblemIds: ["0001"],
          status: "running"
        }
      ],
      createdAt: "2026-07-27T08:00:00.000Z"
    }
  },
  settings: {
    filterOpen: false,
    answerOpen: true,
    answerReferenceOpen: true,
    explanationOpen: false,
    statsOpen: false,
    errorsOpen: true,
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
    speedQuestionSeconds: 60,
    formatOnSubmit: false
  }
};

try {
  const starter = "class Solution:\n    def solve(self):\n        ";
  assert.equal(editorCodeForDraft("", starter), starter);
  assert.equal(editorCodeForDraft("   \n", starter), starter);
  assert.equal(
    editorCodeForDraft(
      "class Solution:\n    def solve(self):\n        ",
      starter
    ),
    starter,
    "舊版只有 signatures 的壓縮骨架必須升級成保留答案行數的新骨架"
  );
  assert.equal(editorCodeForDraft("class Solution:\n    pass", starter), "class Solution:\n    pass");

  const migratedSettings = normalizeState({
    ...state,
    settings: {
      ...state.settings,
      adaptiveAnswerFade: undefined,
      answerRevealMode: undefined,
      answerRevealPercent: undefined,
      answerBrightness: undefined
    }
  }).settings;
  assert.equal(migratedSettings.adaptiveAnswerFade, true);
  assert.equal(migratedSettings.answerRevealMode, "full");
  assert.equal(migratedSettings.answerRevealPercent, 30);
  assert.equal(migratedSettings.answerBrightness, 11);
  assert.deepEqual(
    normalizeState({ ...state, notes: undefined }).notes,
    {},
    "舊資料沒有 notes 時必須安全補成空物件"
  );
  assert.equal(
    normalizeState({ ...state, training: undefined }).training.preset,
    "standard",
    "舊資料沒有 training 時必須安全補上每日特訓預設值"
  );
  assert.deepEqual(
    normalizeState({
      ...state,
      notes: {
        "0001": "保留",
        broken: 123
      }
    }).notes,
    { "0001": "保留" },
    "個人筆記只接受每題對應的 Markdown 字串"
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, answerBrightness: 500 }
    }).settings.answerBrightness,
    100
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, answerBrightness: 1 }
    }).settings.answerBrightness,
    5
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, mode: "explore" }
    }).settings.mode,
    "explore"
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, mode: "speed" }
    }).settings.mode,
    "speed",
    "Speed Mode 必須能安全保留"
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, mode: "repeat" }
    }).settings.mode,
    "repeat",
    "Repeat Mode 必須能安全保留"
  );
  const resumedForcedSession = normalizeState({
    ...state,
    session: {
      ...state.session,
      backHistory: ["previous"],
      speed: {
        phase: "running",
        questionLimitMs: 60_000,
        total: 10,
        score: 100,
        solved: 1,
        timedOut: 0,
        wrongAttempts: 0,
        deadlineAt: 1_800_000_000_000,
        questionId: "0001",
        categories: {}
      },
      repeat: {
        phase: "running",
        stage: 1,
        total: 10,
        completed: 2,
        failedStages: 0
      }
    },
    settings: {
      ...state.settings,
      interviewMinutes: 60,
      randomOrder: true
    }
  });
  assert.deepEqual(resumedForcedSession.session.backHistory, [
    "previous"
  ]);
  assert.equal(resumedForcedSession.session.speed.questionId, "0001");
  assert.equal(resumedForcedSession.session.repeat.stage, 1);
  assert.equal(resumedForcedSession.settings.interviewMinutes, 60);
  assert.equal(resumedForcedSession.settings.randomOrder, true);
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, speedAnswerVisible: true }
    }).settings.speedAnswerVisible,
    true,
    "Speed Mode 的答案預設選項必須保留"
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, speedQuestionSeconds: 90 }
    }).settings.speedQuestionSeconds,
    90,
    "Speed Mode 的自訂秒數必須保留"
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, speedQuestionSeconds: 1 }
    }).settings.speedQuestionSeconds,
    10,
    "Speed Mode 秒數不能低於安全下限"
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, speedQuestionSeconds: 9999 }
    }).settings.speedQuestionSeconds,
    600,
    "Speed Mode 秒數不能超過上限"
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, formatOnSubmit: true }
    }).settings.formatOnSubmit,
    true,
    "送出前格式化設定必須保留"
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, mode: "free" }
    }).settings.mode,
    "free",
    "自由模式必須能安全保留"
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, mode: "review" }
    }).settings.mode,
    "guided",
    "舊版複習模式必須遷移成預設引導模式"
  );
  assert.equal(
    normalizeState({
      ...state,
      version: 3,
      session: {
        ...state.session,
        queue: ["0001"]
      },
      settings: { ...state.settings, mode: "review" }
    }).version,
    CURRENT_STATE_VERSION,
    "舊狀態必須升級成目前的持久化模型"
  );
  assert.deepEqual(
    normalizeState({
      ...state,
      version: 3,
      session: {
        ...state.session,
        queue: ["0001"]
      }
    }).session.queue,
    [],
    "舊分頁的 Speed／Repeat queue 不可污染升級後的引導模式"
  );
  assert.equal(
    normalizeState({
      ...state,
      settings: { ...state.settings, mode: "invalid-mode" }
    }).settings.mode,
    "guided",
    "未知模式必須安全回到引導模式"
  );
  assert.equal(
    normalizeState({
      ...state,
      version: 4,
      settings: {
        ...state.settings,
        answerOpen: true,
        answerReferenceOpen: true
      }
    }).settings.answerOpen,
    false,
    "v5 遷移必須關閉舊版預設答案，避免新回合一開始就被判成輔助作答"
  );
  const v5EvidenceMigration = normalizeState({
    ...state,
    version: 4
  });
  assert.equal(v5EvidenceMigration.records["0001"].memoryPassed, 0);
  assert.equal(v5EvidenceMigration.records["0001"].assistedPassed, 1);
  assert.equal(
    v5EvidenceMigration.records["0001"].status,
    "learning",
    "只有看答案 AC 的舊題必須保留練習紀錄，但不可繼續標成已獨立解決"
  );

  assert.equal(readStoredSnapshot(), null);

  writeStoredState(state);
  const first = readStoredSnapshot();
  assert.equal(first?.state.records["0001"].attempts, 1);
  assert.deepEqual(first?.state.session.backHistory, ["0002"]);
  assert.equal(first?.state.session.currentProblemId, "0001");
  assert.equal(first?.state.session.results[0].actual, "1");
  assert.equal(first?.state.session.submitted, true);
  assert.equal(first?.state.settings.errorsOpen, true);
  assert.equal(first?.state.training.activePlan?.status, "paused");
  assert.deepEqual(
    first?.state.training.activePlan?.blocks[0].remainingProblemIds,
    ["0001"],
    "SQLite 必須保存每日特訓目前區塊與未完成題目"
  );
  assert.equal(
    first?.state.notes["0001"],
    "## 我的推理\n\n用 `set` 記錄看過的值。"
  );
  assert.equal(
    shouldUseLocalSnapshot(
      {
        state: normalizeState(state),
        updatedAt: Date.now() + 10_000,
        valid: true,
        partial: true
      },
      { state: normalizeState(state), updatedAt: Date.now() }
    ),
    false,
    "精簡的 localStorage 備援不可覆蓋完整 SQLite"
  );

  const largeState = {
    ...normalizeState(state),
    submissionHistory: Array.from({ length: 2_000 }, (_, index) => ({
      id: `stress-${index}`,
      problemId: "0001",
      submittedAt: new Date(1_700_000_000_000 + index).toISOString(),
      passed: index % 3 !== 0,
      durationMs: 1_000,
      memoryEligible: true,
      code: "x".repeat(2_000),
      results: [{ name: "壓力測資", passed: true }]
    }))
  };
  const localStressSnapshot = serializeLocalSnapshot(
    largeState,
    500_000
  );
  const parsedStressSnapshot = JSON.parse(localStressSnapshot);
  assert.equal(parsedStressSnapshot.partial, true);
  assert.equal(
    parsedStressSnapshot.protocolVersion,
    2,
    "localStorage 快照必須標記同步協定，避免部署前的舊分頁回寫"
  );
  assert.ok(
    new TextEncoder().encode(localStressSnapshot).byteLength <
      500_000,
    "大型歷史的瀏覽器備援必須壓在安全範圍內"
  );
  assert.equal(
    parsedStressSnapshot.state.submissionHistory.length,
    500,
    "SQLite 保留完整歷史；localStorage 只留固定數量的復原摘要"
  );
  writeStoredState(largeState);
  assert.equal(
    readStoredSnapshot()?.state.submissionHistory.length,
    2_000,
    "SQLite 必須完整保存大型逐筆提交歷史"
  );
  writeStoredState(state);
  assert.equal(first?.state.submissionHistory[0].problemId, "0001");
  assert.equal(
    first?.state.submissionHistory[0].code,
    "class Solution:\\n    return 1"
  );
  assert.equal(first?.state.submissionHistory[0].results[0].passed, true);
  assert.equal(first?.state.submissionHistory[0].hintsUsed, 1);
  assert.equal(first?.state.submissionHistory[0].deletedChars, 80);
  assert.equal(first?.state.submissionHistory[0].inferredRating, "hard");
  assert.ok(Number.isFinite(Date.parse(first?.updatedAt ?? "")));
  const newerSavedAt = Date.parse(first?.updatedAt ?? "") + 2_000;
  const newerState = {
    ...state,
    records: {
      ...state.records,
      "0001": {
        ...state.records["0001"],
        attempts: 2
      }
    }
  };
  assert.equal(
    writeStoredStateIfNewer(newerState, newerSavedAt).applied,
    true
  );
  assert.equal(readStoredSnapshot()?.state.records["0001"].attempts, 2);
  assert.equal(
    writeStoredStateIfNewer(state, newerSavedAt - 1_000).applied,
    false,
    "晚抵達的舊快照不可覆蓋較新的提交與 FSRS 狀態"
  );
  assert.equal(readStoredSnapshot()?.state.records["0001"].attempts, 2);
  writeStoredState(state);

  closeDatabaseForTests();
  const emptyCurrentPath = join(directory, "empty-current.sqlite3");
  new DatabaseSync(emptyCurrentPath).close();
  // 行為更新：選中舊檔時不再直接開舊檔，而是把 app_state 一次性搬到
  // 正規檔後改開新檔；舊檔必須原封不動保留（不刪除、不清空）。
  assert.equal(
    selectDatabaseFile(emptyCurrentPath, process.env.RECODE_DB_PATH),
    emptyCurrentPath,
    "選中舊檔時必須把進度搬進正規檔，之後一律改開新檔"
  );
  const readAppState = (path) => {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return db
        .prepare(
          "SELECT payload, updated_at AS updatedAt FROM app_state WHERE profile_id = ?"
        )
        .get("local");
    } finally {
      db.close();
    }
  };
  const migratedRow = readAppState(emptyCurrentPath);
  assert.ok(migratedRow?.payload, "搬移後正規檔必須包含舊檔的 app_state");
  assert.equal(
    JSON.parse(migratedRow.payload).records["0001"].attempts,
    1,
    "搬移的內容必須與舊檔完全一致"
  );
  const legacyRow = readAppState(process.env.RECODE_DB_PATH);
  assert.ok(legacyRow?.payload, "搬移不可刪除或清空舊檔");
  assert.equal(
    migratedRow.updatedAt,
    legacyRow.updatedAt,
    "搬移必須保留原 updated_at，跨分頁同步比較才不會失真"
  );
  // 正規檔已有同樣新（或更新）的資料時：直接選正規檔，不觸發覆蓋。
  assert.equal(
    selectDatabaseFile(emptyCurrentPath, process.env.RECODE_DB_PATH),
    emptyCurrentPath,
    "正規檔已有不落後的資料時必須直接使用，不可被舊檔覆蓋"
  );

  const backup = await exportDatabase();
  assert.match(
    backup.filename,
    /^recode-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.sqlite3$/
  );
  assert.equal(
    new TextDecoder().decode(backup.bytes.slice(0, 15)),
    "SQLite format 3"
  );

  writeStoredState({
    ...state,
    records: {
      ...state.records,
      "0001": {
        ...state.records["0001"],
        attempts: 9
      }
    }
  });
  assert.equal(readStoredSnapshot()?.state.records["0001"].attempts, 9);

  restoreDatabase(backup.bytes);
  assert.equal(readStoredSnapshot()?.state.records["0001"].attempts, 1);

  const empty = normalizeState(null);
  assert.equal(
    empty.settings.answerOpen,
    false,
    "全新題庫必須先隱藏答案，否則第一次提交永遠不是獨立回想"
  );
  assert.equal(
    shouldUseLocalSnapshot(
      { state: normalizeState(state), updatedAt: 0 },
      { state: empty, updatedAt: Date.now() }
    ),
    true,
    "legacy local progress must beat an accidentally initialized empty database"
  );
  assert.equal(
    shouldUseLocalSnapshot(
      { state: empty, updatedAt: 10 },
      { state: normalizeState(state), updatedAt: 20 }
    ),
    false,
    "a newer database snapshot must remain authoritative"
  );
  assert.equal(
    shouldUseLocalSnapshot(
      {
        state: normalizeState(state),
        updatedAt: Date.now() + 10_000,
        valid: true,
        partial: false,
        protocolVersion: 1
      },
      { state: normalizeState(state), updatedAt: Date.now() }
    ),
    false,
    "舊版分頁的本機快照即使時間較新，也不可覆蓋新版 SQLite"
  );
  assert.equal(
    shouldUseLocalSnapshot(
      {
        state: empty,
        updatedAt: Date.now() + 10_000,
        valid: false
      },
      { state: normalizeState(state), updatedAt: Date.now() }
    ),
    false,
    "損壞的瀏覽器快照不可憑較新時間戳清空有效 SQLite"
  );

  assert.throws(
    () => restoreDatabase(new TextEncoder().encode("not sqlite")),
    /database|SQLite|file is not a database/i
  );

  console.log(
    "database behavior verified: atomic state, migration safety, timestamped backup, restore"
  );
} finally {
  closeDatabaseForTests();
  rmSync(directory, { recursive: true, force: true });
}
