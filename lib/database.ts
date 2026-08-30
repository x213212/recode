import {
  DatabaseSync,
  backup as createSqliteBackup
} from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const PROFILE_ID = "local";
const BACKUP_PREFIX = "recode";

let database: DatabaseSync | null = null;
let openedPath = "";

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS app_state (
    profile_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT INTO schema_meta (key, value)
  VALUES ('schema_version', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
`;

interface StoredStateRow {
  payload: string;
  updatedAt: string;
  timestamp: number;
}

function storedStateRow(path: string): StoredStateRow | null {
  if (!existsSync(path)) return null;

  let candidate: DatabaseSync | null = null;
  try {
    candidate = new DatabaseSync(path, { readOnly: true });
    const row = candidate
      .prepare(
        "SELECT payload, updated_at AS updatedAt FROM app_state WHERE profile_id = ?"
      )
      .get(PROFILE_ID) as
      | { payload?: string; updatedAt?: string }
      | undefined;
    if (!row?.payload || !row.updatedAt) return null;

    const state: unknown = JSON.parse(row.payload);
    assertValidState(state);
    const timestamp = Date.parse(row.updatedAt);
    return {
      payload: row.payload,
      updatedAt: row.updatedAt,
      timestamp: Number.isFinite(timestamp) ? timestamp : 0
    };
  } catch {
    return null;
  } finally {
    candidate?.close();
  }
}

// 把舊檔（rex-recall.sqlite3）的 app_state 一次性搬進正規檔；帶
// WHERE 條件保證只在正規檔沒有更新資料時寫入。舊檔原封不動保留。
function migrateLegacyState(
  targetPath: string,
  row: StoredStateRow
): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const target = new DatabaseSync(targetPath);
  try {
    target.exec(SCHEMA_SQL);
    target
      .prepare(`
        INSERT INTO app_state (profile_id, payload, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          payload = excluded.payload,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at > app_state.updated_at
      `)
      .run(PROFILE_ID, row.payload, row.updatedAt);
  } finally {
    target.close();
  }
}

export function selectDatabaseFile(
  current: string,
  previous: string
): string {
  const currentRow = storedStateRow(current);
  const previousRow = storedStateRow(previous);

  if (
    currentRow &&
    (!previousRow || currentRow.timestamp >= previousRow.timestamp)
  ) {
    return current;
  }

  if (previousRow) {
    // 選中舊檔時不再直接開舊檔：啟動時把 app_state 搬到正規檔後改開
    // 新檔，讓資料庫檔名從此收斂到 recode.sqlite3。
    try {
      migrateLegacyState(current, previousRow);
      console.warn(
        `[recode] 已將舊資料庫 ${previous} 的進度一次性搬移到 ${current}，改用新檔啟動；舊檔保留備援，未刪除。`
      );
      return current;
    } catch (error) {
      // 搬移失敗維持原行為：繼續開舊檔，不能讓使用者的進度消失。
      console.warn(
        `[recode] 舊資料庫搬移到 ${current} 失敗，維持開啟舊檔 ${previous}：`,
        error
      );
      return previous;
    }
  }

  if (existsSync(current)) return current;
  if (existsSync(previous)) return previous;
  return current;
}

function databasePath(): string {
  if (process.env.RECODE_DB_PATH) return process.env.RECODE_DB_PATH;
  if (process.env.REX_RECALL_DB_PATH) return process.env.REX_RECALL_DB_PATH;

  const projectRoot = process.env.RECODE_PROJECT_ROOT ?? process.cwd();
  const current = join(projectRoot, ".local", "recode.sqlite3");
  const previous = join(projectRoot, ".local", "rex-recall.sqlite3");
  return selectDatabaseFile(current, previous);
}

function openDatabase(): DatabaseSync {
  if (database) return database;

  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });
  database = new DatabaseSync(path);
  openedPath = path;
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    ${SCHEMA_SQL}
  `);
  return database;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertValidState(value: unknown): asserts value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    typeof value.version !== "number" ||
    !isRecord(value.drafts) ||
    (value.notes !== undefined && !isRecord(value.notes)) ||
    !isRecord(value.records) ||
    !isRecord(value.customTests) ||
    !isRecord(value.activity) ||
    (value.submissionHistory !== undefined &&
      !Array.isArray(value.submissionHistory)) ||
    (value.recallRounds !== undefined && !Array.isArray(value.recallRounds)) ||
    !isRecord(value.session) ||
    !isRecord(value.settings)
  ) {
    throw new Error("備份內容不是有效的 RECODE 狀態");
  }
}

export function readStoredState(): unknown | null {
  return readStoredSnapshot()?.state ?? null;
}

export function readStoredSnapshot(): {
  state: unknown;
  updatedAt: string;
} | null {
  const row = openDatabase()
    .prepare(
      "SELECT payload, updated_at AS updatedAt FROM app_state WHERE profile_id = ?"
    )
    .get(PROFILE_ID) as
      | { payload?: string; updatedAt?: string }
      | undefined;

  if (!row?.payload || !row.updatedAt) return null;
  const state: unknown = JSON.parse(row.payload);
  assertValidState(state);
  return { state, updatedAt: row.updatedAt };
}

export function writeStoredState(state: unknown): string {
  assertValidState(state);
  const updatedAt = new Date().toISOString();
  const payload = JSON.stringify(state);

  openDatabase()
    .prepare(`
      INSERT INTO app_state (profile_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `)
    .run(PROFILE_ID, payload, updatedAt);

  return updatedAt;
}

export function writeStoredStateIfNewer(
  state: unknown,
  savedAt: number
): { applied: boolean; updatedAt: string } {
  assertValidState(state);
  if (!Number.isFinite(savedAt) || savedAt <= 0) {
    throw new Error("狀態版本時間無效");
  }

  const updatedAt = new Date(savedAt).toISOString();
  const result = openDatabase()
    .prepare(`
      INSERT INTO app_state (profile_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at > app_state.updated_at
    `)
    .run(PROFILE_ID, JSON.stringify(state), updatedAt);

  const stored = readStoredSnapshot();
  return {
    applied: result.changes > 0,
    updatedAt: stored?.updatedAt ?? updatedAt
  };
}

function localTimestamp(date = new Date()): string {
  const number = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    number(date.getMonth() + 1),
    number(date.getDate())
  ].join("-") +
    "_" +
    [
      number(date.getHours()),
      number(date.getMinutes()),
      number(date.getSeconds())
    ].join("-");
}

export async function exportDatabase(): Promise<{
  bytes: Uint8Array;
  filename: string;
}> {
  if (!readStoredState()) {
    throw new Error("資料庫目前沒有可備份的練習紀錄");
  }

  const stamp = localTimestamp();
  const temporaryPath = join(
    tmpdir(),
    `${BACKUP_PREFIX}-${process.pid}-${Date.now()}.sqlite3`
  );

  try {
    await createSqliteBackup(openDatabase(), temporaryPath);
    return {
      bytes: new Uint8Array(readFileSync(temporaryPath)),
      filename: `${BACKUP_PREFIX}-${stamp}.sqlite3`
    };
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The backup failed before the temporary file was created.
    }
  }
}

export function restoreDatabase(
  bytes: Uint8Array,
  savedAt?: number
): unknown {
  const temporaryPath = join(
    tmpdir(),
    `${BACKUP_PREFIX}-restore-${process.pid}-${Date.now()}.sqlite3`
  );
  writeFileSync(temporaryPath, bytes);

  let source: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(temporaryPath, { readOnly: true });
    const row = source
      .prepare(
        "SELECT payload FROM app_state WHERE profile_id = ?"
      )
      .get(PROFILE_ID) as { payload?: string } | undefined;

    if (!row?.payload) {
      throw new Error("選擇的資料庫沒有可還原的練習紀錄");
    }

    const state: unknown = JSON.parse(row.payload);
    assertValidState(state);
    if (savedAt === undefined) {
      writeStoredState(state);
    } else {
      const result = writeStoredStateIfNewer(state, savedAt);
      if (!result.applied) {
        throw new Error("還原版本早於目前資料，已拒絕覆蓋");
      }
    }
    return state;
  } finally {
    source?.close();
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The restore failed before cleanup was possible.
    }
  }
}

export function closeDatabaseForTests(): void {
  database?.close();
  database = null;
  openedPath = "";
}
