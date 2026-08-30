import {
  closeDatabaseForTests,
  readStoredSnapshot,
  writeStoredState
} from "../lib/database.ts";
import { rebuildMemoryCards } from "../lib/memoryEvidence.ts";
import { normalizeState } from "../lib/storage.ts";

const snapshot = readStoredSnapshot();
if (!snapshot) {
  throw new Error("找不到可修復的 RECODE 資料庫狀態");
}

const state = normalizeState(snapshot.state);
const repaired = rebuildMemoryCards(
  state.records,
  state.submissionHistory
);

const nextState = {
  ...state,
  records: repaired.records,
  session: {
    ...state.session,
    queue: [],
    initialTotal: 0,
    problemTimer: {
      started: false,
      elapsedMs: 0
    },
    attempted: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    totalMs: 0
  },
  settings: {
    ...state.settings,
    mode: "guided",
    answerOpen: false,
    answerReferenceOpen: false,
    explanationOpen: false
  }
};

const dryRun = process.argv.includes("--dry-run");
const updatedAt = dryRun
  ? snapshot.updatedAt
  : writeStoredState(nextState);
closeDatabaseForTests();

console.log(
  JSON.stringify(
    {
      updatedAt,
      dryRun,
      events: nextState.submissionHistory.length,
      records: Object.keys(nextState.records).length,
      ...repaired.report
    },
    null,
    2
  )
);
