"use client";

import {
  AlertTriangle,
  BookOpen,
  Braces,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  Compass,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  Filter,
  Flame,
  History,
  Languages,
  ListFilter,
  LockKeyhole,
  LoaderCircle,
  Menu,
  Pause,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  SkipForward,
  SlidersHorizontal,
  Star,
  TerminalSquare,
  TimerReset,
  Upload,
  Wrench,
  X,
  Zap
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import CodeEditor, {
  type CodeEditorHandle
} from "@/components/CodeEditor";
import DailyTrainingMenu from "@/components/DailyTrainingMenu";
import ErrorOverview from "@/components/ErrorOverview";
import MarkdownBlock from "@/components/MarkdownBlock";
import ProblemLibrary from "@/components/ProblemLibrary";
import SpeedModeScreen from "@/components/SpeedModeScreen";
import SubmissionHistoryDrawer from "@/components/SubmissionHistoryDrawer";
import TrainingDashboard from "@/components/TrainingDashboard";
import {
  recordSubmission as recordActivitySubmission,
  removeProblemSubmissions
} from "@/lib/activity";
import {
  adaptiveAnswerPercent,
  answerDisplayPolicy,
  buildRevealedAnswer
} from "@/lib/answerReveal";
import { explanationLineMapMarkdown } from "@/lib/explanationLineMap";
import { summarizeDailyProgress } from "@/lib/dailyProgress";
import {
  attemptElapsedMs,
  beginOrResumeAttempt,
  emptyAttemptTimer,
  normalizeAttemptTimer,
  pauseAttempt
} from "@/lib/attemptTimer";
import {
  FSRS_ALGORITHM_VERSION,
  familiarityLabel,
  formatDue,
  formatFsrsRating,
  retrievability,
  scheduleReview
} from "@/lib/fsrs";
import {
  memoryEligiblePassCount,
  recentMemoryFailureCount,
  reviewOriginForRecord,
  statusAfterSubmissionEvidence,
  submissionMemoryPolicy
} from "@/lib/memoryEvidence";
import {
  activeRecallRound,
  abandonRound,
  deferRound,
  markAssisted,
  recordFsrsWrite,
  recordSubmission as recordRecallSubmission,
  startOrResumeRound
} from "@/lib/recallRound";
import { createRandomId } from "@/lib/randomId";
import {
  type DifficultyFilter,
  assessAcceptedSubmission,
  advancePracticeQueue,
  explorationPool,
  guidedSelectionReason,
  independentPassCount,
  insertDueReviewsAfterCurrent,
  isRecordReadyForReview,
  matchesDifficultyFilter,
  matchesProblemLibraryQuery,
  normalizePracticeQueue,
  practiceModeSwitchPolicy,
  queueAfterPreservedModeSwitch,
  recordAfterSkipping,
  rememberPracticeProblem,
  sessionProblemsForMode,
  restorePreviousPracticeProblem,
  statusAfterLeavingEditedProblem,
  statusAfterResettingProblem
} from "@/lib/review";
import {
  EMPTY_STATE,
  LOCAL_UPDATED_AT_KEY,
  defaultRecord,
  editorCodeForDraft,
  labelForStatus,
  loadLocalSnapshot,
  loadStateFromDatabase,
  nextStateSaveTimestamp,
  normalizeState,
  saveState,
  saveStateToDatabase,
  shouldUseLocalSnapshot
} from "@/lib/storage";
import {
  buildDailyTrainingPlan,
  currentTrainingBlock,
  nextTrainingDay,
  pauseTrainingPlan,
  recordTrainingProblemOutcome,
  startTrainingBlock,
  syncTrainingPlanQueue,
  trainingDateKey,
  trainingPlanForDate,
  trainingProgramWithCompletedPlan
} from "@/lib/trainingPlan";
import {
  WRITER_HEARTBEAT_MS,
  WRITER_LEASE_KEY,
  claimWriterLease,
  leaseIsActive,
  readWriterLease,
  releaseWriterLease,
  renewWriterLease
} from "@/lib/tabCoordinator";
import {
  failureReason,
  firstFailedResult,
  hasRunnerFailure
} from "@/lib/testResultSummary";
import { sourceLineFromTestResult } from "@/lib/errorLocation";
import {
  emptySpeedSession,
  nextSpeedCategoryStats,
  speedAnswerPolicy,
  speedQuestionLimitMs,
  speedQueue,
  speedScore,
  speedSubmissionCanAdvance,
  speedTimerTone,
  type SpeedSessionState
} from "@/lib/speedMode";
import {
  emptyRepeatSession,
  repeatCheckpointDue,
  repeatRevealPercent,
  repeatSubmissionTransition,
  type RepeatSessionState
} from "@/lib/repeatMode";
import type { PythonFormatResult } from "@/lib/pythonFormatter";
import { shouldFormatBeforeSubmit } from "@/lib/pythonFormatPolicy";
import type {
  CustomTestCase,
  Difficulty,
  AttemptTimerState,
  DailyTrainingPlan,
  PersistedState,
  PracticeMode,
  ProblemDetail,
  ProblemIndex,
  ProblemSummary,
  PythonToolInfo,
  ReviewOrigin,
  SubmissionEvent,
  StudyRecord,
  StudyStatus,
  TestCase,
  TestResult,
  TrainingMenuSize
} from "@/lib/types";
import { usePythonRunner } from "@/lib/usePythonRunner";

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "簡單",
  medium: "中等",
  hard: "困難",
  unknown: "未標示"
};

const REVIEW_ORIGINS = new Set<ReviewOrigin>([
  "new",
  "retry",
  "fsrs-due",
  "checkpoint-due",
  "early",
  "manual",
  "same-session"
]);

function recallRoundReviewOrigin(
  value: string,
  fallback: ReviewOrigin
): ReviewOrigin {
  return REVIEW_ORIGINS.has(value as ReviewOrigin)
    ? (value as ReviewOrigin)
    : fallback;
}

interface Filters {
  query: string;
  category: string;
  source: string;
  difficulty: DifficultyFilter;
  status: "all" | StudyStatus | "due" | "starred" | "solved";
}

interface ReviewActionTelemetry {
  hintsUsed: number;
  insertedChars: number;
  deletedChars: number;
  editOperations: number;
  resetCount: number;
  answerRevealCount: number;
}

interface AttemptContext {
  timer: AttemptTimerState;
  actions: ReviewActionTelemetry;
}

type TabRole = "checking" | "primary" | "secondary";
type EditorEntryMode = "resume-draft" | "fresh-skeleton";

interface SpeedFeedback {
  kind: "success" | "timeout" | "failure";
  message: string;
}

function emptyReviewActionTelemetry(): ReviewActionTelemetry {
  return {
    hintsUsed: 0,
    insertedChars: 0,
    deletedChars: 0,
    editOperations: 0,
    resetCount: 0,
    answerRevealCount: 0
  };
}

const INITIAL_FILTERS: Filters = {
  query: "",
  category: "all",
  source: "all",
  difficulty: "all",
  status: "all"
};

function secondsLabel(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function recordFor(state: PersistedState, id: string): StudyRecord {
  return { ...defaultRecord(), ...(state.records[id] ?? {}) };
}

// 秒級跳動的顯示元件自帶 interval，父層不必為了每秒更新的文字整棵重渲染。
// active 為 false 時不裝 interval；resyncKey 變動時立刻對齊一次目前時間，
// 避免沿用上一題留下的過期 now。
function useDisplayClock(active: boolean, resyncKey?: unknown) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, resyncKey]);
  return now;
}

const AttemptTimerDisplay = memo(function AttemptTimerDisplay({
  timer
}: {
  timer: AttemptTimerState;
}) {
  const running = timer.runningSince !== undefined;
  const now = useDisplayClock(running);
  const elapsedSeconds = attemptElapsedMs(timer, now) / 1000;
  return (
    <span
      className={!timer.started ? "timer-idle" : ""}
      title={
        timer.started
          ? "本次輸入到送出的作答時間"
          : "第一次在 editor 輸入後開始計時"
      }
    >
      <Clock3 size={15} />
      {secondsLabel(elapsedSeconds)}
    </span>
  );
});

const InterviewCountdown = memo(function InterviewCountdown({
  startedAt,
  minutes
}: {
  startedAt: number;
  minutes: number;
}) {
  const now = useDisplayClock(true, startedAt);
  const remaining = minutes * 60 - (now - startedAt) / 1000;
  return (
    <span className={remaining < 300 ? "time-danger" : ""}>
      <TimerReset size={15} />
      {secondsLabel(remaining)}
    </span>
  );
});

const SpeedHud = memo(function SpeedHud({
  phase,
  score,
  questionActive,
  timedOut,
  deadlineAt,
  limitMs,
  queueCount
}: {
  phase: SpeedSessionState["phase"];
  score: number;
  questionActive: boolean;
  timedOut: boolean;
  deadlineAt: number | undefined;
  limitMs: number;
  queueCount: number;
}) {
  const counting =
    questionActive && deadlineAt !== undefined && !timedOut;
  const now = useDisplayClock(counting, deadlineAt);
  // 逾時判定由父層的 deadline setTimeout 決定；這裡只負責顯示。
  // phase 進入 timeout 時剩餘時間必為 0，直接顯示 0 以免顯示殘值。
  const remainingMs =
    !questionActive || deadlineAt === undefined
      ? limitMs
      : timedOut
        ? 0
        : Math.max(0, deadlineAt - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const tone = speedTimerTone(remainingMs, limitMs);
  const progressPercent = Math.round((remainingMs / limitMs) * 100);
  return (
    <div className={`speed-hud ${tone} ${timedOut ? "timed-out" : ""}`}>
      <span className="speed-hud-score">{score.toLocaleString("zh-TW")} 分</span>
      {questionActive ? (
        <>
          <span className="speed-hud-timer">
            <TimerReset size={15} />
            {timedOut ? "重打關" : `${remainingSeconds}s`}
          </span>
          <span className="speed-hud-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
            <span style={{ width: `${progressPercent}%` }} />
          </span>
        </>
      ) : (
        <span className="timer-idle">
          {phase === "finished" ? "本輪結算" : "等待開始"}
        </span>
      )}
      <span className="queue-pill">{queueCount} 關</span>
    </div>
  );
});

function shuffled<T>(items: T[]) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const next = Math.floor(Math.random() * (index + 1));
    [result[index], result[next]] = [result[next], result[index]];
  }
  return result;
}

function programWithPausedTraining(
  program: PersistedState["training"]
): PersistedState["training"] {
  const activePlan = pauseTrainingPlan(program.activePlan);
  return activePlan === program.activePlan
    ? program
    : { ...program, activePlan };
}

const PythonToolsSection = memo(function PythonToolsSection({
  tools
}: {
  tools: PythonToolInfo[] | undefined;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (!tools || tools.length === 0) return null;
  const expanded = tools.find((tool) => tool.id === expandedId) ?? null;
  return (
    <section className="python-tools" aria-label="本題用到的 Python 工具">
      <div className="python-tools-title">
        <Wrench size={14} />
        本題用到的 Python 工具
        <em>點名稱看一行說明＋小範例</em>
      </div>
      <div className="python-tools-chips">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`python-tool-chip ${
              tool.id === expandedId ? "active" : ""
            }`}
            aria-expanded={tool.id === expandedId}
            onClick={() =>
              setExpandedId((current) =>
                current === tool.id ? null : tool.id
              )
            }
          >
            {tool.name}
          </button>
        ))}
      </div>
      {expanded && (
        <div className="python-tool-detail">
          <p>{expanded.note}</p>
          <pre>{expanded.example}</pre>
        </div>
      )}
    </section>
  );
});

function explanationMarkdown(problem: ProblemDetail) {
  const lineMap = explanationLineMapMarkdown(problem);
  return [
    `## 1. 題目要你交付什麼\n\n${problem.goal}`,
    `### 從題目本身先確定的規則\n\n${problem.facts}`,
    `## 2. 先照直覺做，真正卡在哪裡\n\n${problem.friction}`,
    `## 3. 解法主幹是怎麼被逼出來的\n\n${problem.route}`,
    `### 程式執行時只保存必要狀態\n\n${problem.state}`,
    `### 用圖先固定最容易混亂的關係\n\n${problem.diagram}`,
    `## 4. 從必要決定逐步推出程式碼\n\n${problem.derivation}`,
    `## 5. 用測資完整走一遍\n\n${problem.trace}`,
    `## 6. 為什麼走完不會漏答案\n\n${problem.proof}`,
    `### 為什麼不是另一種常見寫法\n\n${problem.wrongAlternative}`,
    `## 7. 關掉答案後重新建構\n\n${problem.rebuild}`,
    `> [!IMPORTANT]\n> **最後才壓成一句：** ${problem.memoryLine}`,
    lineMap
  ].join("\n\n");
}

export default function StudyWorkspace() {
  const [persisted, setPersistedState] =
    useState<PersistedState>(EMPTY_STATE);
  const persistedRef = useRef(persisted);
  const [tabRole, setTabRole] = useState<TabRole>("checking");
  const tabRoleRef = useRef<TabRole>("checking");
  const tabIdRef = useRef("");
  const lastAppliedSnapshotRef = useRef(0);
  const setPersisted = useCallback(
    (action: SetStateAction<PersistedState>) => {
      if (tabRoleRef.current === "secondary") return;
      const previous = persistedRef.current;
      const next =
        typeof action === "function"
          ? (
              action as (
                current: PersistedState
              ) => PersistedState
            )(previous)
          : action;
      persistedRef.current = next;
      setPersistedState(next);
    },
    []
  );
  const [hydrated, setHydrated] = useState(false);
  const [indexData, setIndexData] = useState<ProblemIndex | null>(null);
  const [indexLoadError, setIndexLoadError] = useState<string | null>(null);
  const [indexLoadAttempt, setIndexLoadAttempt] = useState(0);
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [problemLoadError, setProblemLoadError] = useState<string | null>(null);
  const [problemLoadAttempt, setProblemLoadAttempt] = useState(0);
  const [queue, setQueue] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [code, setCode] = useState("");
  const codeRef = useRef("");
  const latestDraftRef = useRef<{ id: string; value: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteView, setNoteView] = useState<"source" | "preview">(
    "source"
  );
  const [noteSaveStatus, setNoteSaveStatus] = useState<
    "saved" | "saving"
  >("saved");
  const latestNoteRef = useRef<{ id: string; value: string } | null>(
    null
  );
  const editedCurrentProblemRef = useRef(false);
  const reviewActionsRef = useRef<ReviewActionTelemetry>(
    emptyReviewActionTelemetry()
  );
  const attemptContextsRef = useRef<Record<string, AttemptContext>>({});
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const databaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const [databaseStatus, setDatabaseStatus] = useState<
    "loading" | "saving" | "saved" | "error"
  >("loading");
  const [databaseMessage, setDatabaseMessage] = useState("正在讀取本機資料庫");
  const [editorRevision, setEditorRevision] = useState(0);
  const [results, setResults] = useState<TestResult[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [customExpected, setCustomExpected] = useState("");
  const [showCustomTest, setShowCustomTest] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [answerControlsOpen, setAnswerControlsOpen] = useState(false);
  const [answerComparisonOpen, setAnswerComparisonOpen] = useState(false);
  const [resetControlsOpen, setResetControlsOpen] = useState(false);
  const [formatControlsOpen, setFormatControlsOpen] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [formatFeedback, setFormatFeedback] =
    useState<PythonFormatResult | null>(null);
  const [answerRevealSeed, setAnswerRevealSeed] = useState(0);
  const [problemHistoryOpen, setProblemHistoryOpen] = useState(false);
  const [trainingMenuOpen, setTrainingMenuOpen] = useState(false);
  const previousTrainingStatusRef = useRef<string | undefined>(undefined);
  const [sessionStartedAt, setSessionStartedAt] = useState(Date.now());
  const [problemTimer, setProblemTimer] = useState<AttemptTimerState>(
    emptyAttemptTimer
  );
  const problemTimerRef = useRef(problemTimer);
  const codeEditorRef = useRef<CodeEditorHandle>(null);
  const formattingInFlightRef = useRef(false);
  const executionInFlightRef = useRef(false);
  const problemTransitionRef = useRef(false);
  const sessionRevisionRef = useRef(0);
  const activeProblemIdRef = useRef("");
  const nextEditorEntryModeRef = useRef<EditorEntryMode>(
    "resume-draft"
  );
  const [editorEntryRevision, setEditorEntryRevision] = useState(0);
  const [clockNow, setClockNow] = useState(Date.now());
  const [interviewMinutes, setInterviewMinutes] = useState(45);
  const [randomOrder, setRandomOrder] = useState(false);
  const [speedSession, setSpeedSession] = useState<SpeedSessionState>(
    emptySpeedSession
  );
  const speedSessionRef = useRef(speedSession);
  const [repeatSession, setRepeatSession] = useState<RepeatSessionState>(
    emptyRepeatSession
  );
  const repeatSessionRef = useRef(repeatSession);
  const [speedFeedback, setSpeedFeedback] = useState<SpeedFeedback | null>(
    null
  );
  const [repeatFeedback, setRepeatFeedback] = useState<SpeedFeedback | null>(
    null
  );
  const [backHistory, setBackHistory] = useState<string[]>([]);
  const [sessionStats, setSessionStats] = useState({
    attempted: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    totalMs: 0
  });
  const [sessionGoal, setSessionGoal] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [resizingEditor, setResizingEditor] = useState(false);
  const editorResizeStartRef = useRef({ y: 0, height: 520 });
  const initialSessionHandledRef = useRef(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const { run, status: runnerStatus } = usePythonRunner();

  const updateSpeedSession = useCallback(
    (updater: (current: SpeedSessionState) => SpeedSessionState) => {
      const next = updater(speedSessionRef.current);
      speedSessionRef.current = next;
      setSpeedSession(next);
    },
    []
  );
  const updateRepeatSession = useCallback(
    (updater: (current: RepeatSessionState) => RepeatSessionState) => {
      const next = updater(repeatSessionRef.current);
      repeatSessionRef.current = next;
      setRepeatSession(next);
    },
    []
  );

  const mode = persisted.settings.mode;
  const runnerBusy =
    formatting ||
    runnerStatus === "executing" ||
    runnerStatus === "runtime-loading";
  const currentId = queue[0] ?? "";
  const ensureRecallRound = useCallback(
    (at: Date = new Date()) => {
      if (!currentId) return undefined;
      let selected = activeRecallRound(
        persistedRef.current.recallRounds,
        currentId,
        mode
      );
      const assistedAtStart =
        mode === "repeat" ||
        (mode === "speed" &&
          persistedRef.current.settings.speedAnswerVisible) ||
        persistedRef.current.settings.answerOpen ||
        persistedRef.current.settings.answerReferenceOpen ||
        persistedRef.current.settings.explanationOpen;

      setPersisted((previous) => {
        const existing = activeRecallRound(
          previous.recallRounds,
          currentId,
          mode
        );
        if (existing) {
          if (!assistedAtStart || existing.evidence === "assisted") {
            selected = existing;
            return previous;
          }
          const recallRounds = markAssisted(previous.recallRounds, {
            eventId: createRandomId(),
            roundId: existing.id,
            problemId: currentId,
            at
          });
          selected = activeRecallRound(recallRounds, currentId, mode);
          const assistedReason =
            mode === "repeat"
              ? "repeat-guided"
              : mode === "speed"
                ? "speed-answer-visible"
                : "answer-assisted";
          return {
            ...previous,
            recallRounds,
            submissionHistory: previous.submissionHistory.map((event) =>
              event.roundId === existing.id
                ? {
                    ...event,
                    memoryEligible: false,
                    memoryEvidenceReason: assistedReason
                  }
                : event
            )
          };
        }

        let origin = reviewOriginForRecord(
          previous.records[currentId],
          mode,
          at
        );
        const completedInThisSession = previous.recallRounds.some(
          (round) =>
            round.problemId === currentId &&
            round.state === "completed" &&
            Date.parse(round.closedAt ?? round.updatedAt) >= sessionStartedAt
        );
        if (origin === "early" && completedInThisSession) {
          origin = "same-session";
        }
        const recallRounds = startOrResumeRound(previous.recallRounds, {
          eventId: createRandomId(),
          roundId: createRandomId(),
          problemId: currentId,
          at,
          mode,
          origin,
          assisted: assistedAtStart
        });
        selected = activeRecallRound(recallRounds, currentId, mode);
        return { ...previous, recallRounds };
      });
      return selected;
    },
    [currentId, mode, sessionStartedAt, setPersisted]
  );

  const markCurrentRecallAssisted = useCallback(
    (
      at: Date = new Date(),
      reason: "answer-assisted" | "speed-timeout-rewrite" =
        "answer-assisted"
    ) => {
      const round = ensureRecallRound(at);
      if (!round || round.evidence === "assisted") return round;
      let selected = round;
      setPersisted((previous) => {
        const recallRounds = markAssisted(previous.recallRounds, {
          eventId: createRandomId(),
          roundId: round.id,
          problemId: currentId,
          at
        });
        selected =
          activeRecallRound(recallRounds, currentId, mode) ?? round;
        return {
          ...previous,
          recallRounds,
          // assistance 是整個回合的 sticky 屬性；在答案打開前已送出的
          // WA 也不能留在校準／下一次評分的證據鏈裡。
          submissionHistory: previous.submissionHistory.map((event) =>
            event.roundId === round.id
              ? {
                  ...event,
                  memoryEligible: false,
                  memoryEvidenceReason: reason
                }
              : event
          )
        };
      });
      return selected;
    },
    [currentId, ensureRecallRound, mode, setPersisted]
  );
  useEffect(() => {
    // 並排對照只屬於目前這一題；換題或換模式後回到半透明底稿。
    setAnswerComparisonOpen(false);
  }, [currentId, mode]);
  const updateProblemTimer = useCallback(
    (updater: (current: AttemptTimerState) => AttemptTimerState) => {
      const next = updater(problemTimerRef.current);
      problemTimerRef.current = next;
      setProblemTimer(next);
    },
    []
  );
  const resetProblemTimer = useCallback(() => {
    const next = emptyAttemptTimer();
    problemTimerRef.current = next;
    setProblemTimer(next);
    setClockNow(Date.now());
  }, []);
  const beginProblemTransition = useCallback(() => {
    if (
      executionInFlightRef.current ||
      problemTransitionRef.current
    ) {
      return false;
    }
    problemTransitionRef.current = true;
    window.requestAnimationFrame(() => {
      problemTransitionRef.current = false;
    });
    return true;
  }, []);
  const startFreshEditorEntry = useCallback(() => {
    nextEditorEntryModeRef.current = "fresh-skeleton";
    // A retry queue with one problem keeps the same currentId. The revision
    // still makes that problem load again as a new reconstruction attempt.
    setEditorEntryRevision((revision) => revision + 1);
  }, []);
  const resumeEditorDraft = useCallback(() => {
    nextEditorEntryModeRef.current = "resume-draft";
  }, []);
  const commitLatestNote = useCallback(() => {
    if (noteTimerRef.current) {
      clearTimeout(noteTimerRef.current);
      noteTimerRef.current = null;
    }
    const latest = latestNoteRef.current;
    if (!latest) return;

    setPersisted((previous) => {
      const saved = previous.notes[latest.id] ?? "";
      if (saved === latest.value) return previous;

      const notes = { ...previous.notes };
      if (latest.value.trim()) {
        notes[latest.id] = latest.value;
      } else {
        delete notes[latest.id];
      }
      return { ...previous, notes };
    });
    setNoteSaveStatus("saved");
  }, [setPersisted]);
  const markCurrentProblemAttempting = useCallback(() => {
    commitLatestNote();
    const activeId =
      activeProblemIdRef.current || latestDraftRef.current?.id;
    if (activeId) {
      attemptContextsRef.current[activeId] = {
        timer: pauseAttempt(problemTimerRef.current, Date.now()),
        actions: { ...reviewActionsRef.current }
      };
    }
    if (!editedCurrentProblemRef.current) return;

    editedCurrentProblemRef.current = false;
    const latest = latestDraftRef.current;
    if (!latest) return;

    setPersisted((previous) => {
      const record = recordFor(previous, latest.id);
      const nextStatus = statusAfterLeavingEditedProblem(record);
      return {
        ...previous,
        drafts: {
          ...previous.drafts,
          [latest.id]: latest.value
        },
        records:
          nextStatus === record.status
            ? previous.records
            : {
                ...previous.records,
                [latest.id]: {
                  ...record,
                  status: nextStatus,
                  lastStudiedAt: new Date().toISOString()
                }
              }
      };
    });
  }, [commitLatestNote, setPersisted]);

  const applyPersistedSnapshot = useCallback(
    (restored: PersistedState, updatedAt = Date.now()) => {
      lastAppliedSnapshotRef.current = Math.max(
        lastAppliedSnapshotRef.current,
        updatedAt
      );
      persistedRef.current = restored;
      setPersistedState(restored);
      setQueue(restored.session.queue);
      setSessionGoal(restored.session.initialTotal);
      setSessionStats({
        attempted: restored.session.attempted,
        passed: restored.session.passed,
        failed: restored.session.failed,
        skipped: restored.session.skipped,
        totalMs: restored.session.totalMs
      });
      setSessionStartedAt(restored.session.startedAt ?? Date.now());
      setBackHistory(restored.session.backHistory);
      speedSessionRef.current = restored.session.speed;
      setSpeedSession(restored.session.speed);
      repeatSessionRef.current = restored.session.repeat;
      setRepeatSession(restored.session.repeat);
      setInterviewMinutes(restored.settings.interviewMinutes);
      setRandomOrder(restored.settings.randomOrder);
      setFilters(restored.settings.filters);
      const restoredCurrentId = restored.session.queue[0];
      const canRestoreResults =
        Boolean(restoredCurrentId) &&
        restored.session.currentProblemId === restoredCurrentId;
      setResults(canRestoreResults ? restored.session.results : []);
      setSubmitted(
        canRestoreResults ? restored.session.submitted : false
      );

      const restoredTimer = normalizeAttemptTimer(
        restored.session.problemTimer
      );
      const pausedRestoredTimer = {
        started: restoredTimer.started,
        elapsedMs: attemptElapsedMs(restoredTimer, Date.now())
      };
      problemTimerRef.current = pausedRestoredTimer;
      setProblemTimer(pausedRestoredTimer);
      setClockNow(Date.now());
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      // 每次載入都建立新的分頁身分。Safari「複製分頁」會複製
      // sessionStorage；若把 ID 存在裡面，兩個分頁會誤認為同一位寫入者。
      const tabId = createRandomId();
      tabIdRef.current = tabId;
      const ownsWriterLease =
        document.visibilityState === "visible" &&
        claimWriterLease(window.localStorage, tabId);
      const initialRole: TabRole = ownsWriterLease
        ? "primary"
        : "secondary";
      tabRoleRef.current = initialRole;
      setTabRole(initialRole);

      const local = loadLocalSnapshot();
      let restored = local.state;
      let restoredAt = local.updatedAt;

      try {
        const stored = await loadStateFromDatabase();
        nextStateSaveTimestamp(
          Math.max(
            Date.now(),
            local.updatedAt,
            stored?.updatedAt ?? 0
          )
        );
        if (shouldUseLocalSnapshot(local, stored)) {
          const savedAt =
            local.updatedAt || nextStateSaveTimestamp();
          restoredAt = savedAt;
          if (ownsWriterLease) {
            await saveStateToDatabase(local.state, false, savedAt);
          }
        } else {
          if (!stored) throw new Error("SQLite 狀態讀取失敗");
          restored = stored.state;
          restoredAt = stored.updatedAt;
          saveState(restored, stored.updatedAt);
        }
        setDatabaseStatus("saved");
        setDatabaseMessage("進度已同步到本機 SQLite");
      } catch (error) {
        setDatabaseStatus("error");
        setDatabaseMessage(
          error instanceof Error
            ? `SQLite 暫時無法使用，已保留瀏覽器備援：${error.message}`
            : "SQLite 暫時無法使用，已保留瀏覽器備援"
        );
      }

      if (cancelled) return;
      applyPersistedSnapshot(restored, restoredAt);
      setHydrated(true);
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [applyPersistedSnapshot]);

  useEffect(() => {
    if (!hydrated) return;
    persistedRef.current = persisted;
    if (tabRole !== "primary") return;
    const savedAt = nextStateSaveTimestamp();
    lastAppliedSnapshotRef.current = savedAt;
    saveState(persisted, savedAt);
    setDatabaseStatus("saving");
    setDatabaseMessage("正在寫入本機 SQLite");
    if (databaseTimerRef.current) clearTimeout(databaseTimerRef.current);
    databaseTimerRef.current = setTimeout(() => {
      void saveStateToDatabase(persisted, false, savedAt)
        .then(() => {
          setDatabaseStatus("saved");
          setDatabaseMessage("進度已同步到本機 SQLite");
        })
        .catch((error) => {
          setDatabaseStatus("error");
          setDatabaseMessage(
            error instanceof Error
              ? `SQLite 寫入失敗，瀏覽器備援仍在：${error.message}`
              : "SQLite 寫入失敗，瀏覽器備援仍在"
          );
        });
    }, 300);

    return () => {
      if (databaseTimerRef.current) clearTimeout(databaseTimerRef.current);
    };
  }, [hydrated, persisted, tabRole]);

  useEffect(() => {
    if (!hydrated || !tabIdRef.current) return;
    const tabId = tabIdRef.current;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;

    const setRole = (role: TabRole) => {
      tabRoleRef.current = role;
      setTabRole(role);
    };

    const syncLatestLocalSnapshot = () => {
      const latest = loadLocalSnapshot();
      if (
        !latest.valid ||
        latest.partial ||
        latest.updatedAt <= lastAppliedSnapshotRef.current
      ) {
        return;
      }
      applyPersistedSnapshot(latest.state, latest.updatedAt);
      setDatabaseStatus("saved");
      setDatabaseMessage("已同步主分頁的最新進度");
    };

    const attemptToBecomePrimary = () => {
      syncLatestLocalSnapshot();
      const claimed = claimWriterLease(
        window.localStorage,
        tabId
      );
      setRole(claimed ? "primary" : "secondary");
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOCAL_UPDATED_AT_KEY) {
        if (tabRoleRef.current !== "primary") {
          syncLatestLocalSnapshot();
        }
        return;
      }

      if (event.key !== WRITER_LEASE_KEY) return;
      const lease = readWriterLease(window.localStorage);
      if (lease?.tabId === tabId && leaseIsActive(lease)) {
        setRole("primary");
        return;
      }
      if (leaseIsActive(lease)) {
        setRole("secondary");
        syncLatestLocalSnapshot();
        return;
      }
      if (document.visibilityState === "visible") {
        attemptToBecomePrimary();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        if (releaseTimer) {
          clearTimeout(releaseTimer);
          releaseTimer = null;
        }
        attemptToBecomePrimary();
        return;
      }

      if (tabRoleRef.current !== "primary") return;
      // The existing visibility handler flushes the latest editor state
      // synchronously. Release on the next task so that flush runs first.
      releaseTimer = setTimeout(() => {
        if (releaseWriterLease(window.localStorage, tabId)) {
          setRole("secondary");
        }
      }, 0);
    };

    const handlePageHide = () => {
      releaseWriterLease(window.localStorage, tabId);
    };

    const heartbeat = window.setInterval(() => {
      if (tabRoleRef.current === "primary") {
        if (!renewWriterLease(window.localStorage, tabId)) {
          setRole("secondary");
          syncLatestLocalSnapshot();
        }
        return;
      }

      const lease = readWriterLease(window.localStorage);
      if (
        document.visibilityState === "visible" &&
        !leaseIsActive(lease)
      ) {
        attemptToBecomePrimary();
      }
    }, WRITER_HEARTBEAT_MS);

    window.addEventListener("storage", handleStorage);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(heartbeat);
      if (releaseTimer) clearTimeout(releaseTimer);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener(
        "visibilitychange",
        handleVisibility
      );
      releaseWriterLease(window.localStorage, tabId);
    };
  }, [applyPersistedSnapshot, hydrated]);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/index.json")
      .then((response) => {
        if (!response.ok) throw new Error("題庫索引載入失敗");
        return response.json();
      })
      .then((payload: ProblemIndex) => {
        if (cancelled) return;
        setIndexLoadError(null);
        setIndexData(payload);
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setIndexLoadError(
            "題庫索引載入失敗，請確認網路連線後再試一次。"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [indexLoadAttempt]);

  const matchingProblems = useMemo(() => {
    if (!indexData) return [];
    const query = filters.query.trim().toLowerCase();
    return indexData.problems.filter((item) => {
      if (query && !matchesProblemLibraryQuery(item, query)) {
        return false;
      }
      if (filters.category !== "all" && item.category !== filters.category) {
        return false;
      }
      if (filters.source !== "all" && !item.sources.includes(filters.source)) {
        return false;
      }
      if (
        !matchesDifficultyFilter(
          item.difficulty,
          filters.difficulty
        )
      ) {
        return false;
      }
      return true;
    });
  }, [
    filters.category,
    filters.difficulty,
    filters.query,
    filters.source,
    indexData
  ]);

  const filteredProblems = useMemo(() => {
    return matchingProblems.filter((item) => {
      const record = persisted.records[item.id] ?? defaultRecord();
      if (
        filters.status === "due" &&
        !isRecordReadyForReview(record, new Date(clockNow))
      ) {
        return false;
      }
      if (filters.status === "starred" && !record.starred) return false;
      // 已解決必須至少有一次沒有答案協助的 AC。跟打通過仍保留在
      // 「正確」統計，但不能冒充已經能獨立重建。
      if (
        filters.status === "solved" &&
        independentPassCount(record) <= 0
      ) {
        return false;
      }
      if (
        !["all", "due", "starred", "solved"].includes(filters.status) &&
        record.status !== filters.status
      ) {
        return false;
      }
      return true;
    });
  }, [clockNow, filters.status, matchingProblems, persisted.records]);

  const explorationProblems = useMemo(
    () => explorationPool(filteredProblems, persisted.records),
    [filteredProblems, persisted.records]
  );
  const speedEligibleProblems = useMemo(
    () =>
      filteredProblems.filter(
        (item) => item.runnable && item.testCount > 0
      ),
    [filteredProblems]
  );
  const speedReadyProblems = useMemo(
    () =>
      speedQueue(
        speedEligibleProblems,
        persisted.records,
        0,
        new Date(clockNow)
      ),
    [clockNow, persisted.records, speedEligibleProblems]
  );
  // startSpeedChallenge 透過 ref 取用最新題組，callback 本身維持穩定，
  // 子元件（SpeedModeScreen）才有辦法 memo。
  const speedReadyProblemsRef = useRef(speedReadyProblems);
  speedReadyProblemsRef.current = speedReadyProblems;
  const repeatEligibleProblems = useMemo(
    () =>
      filteredProblems.filter(
        (item) => item.runnable && item.testCount > 0
      ),
    [filteredProblems]
  );
  const startSession = useCallback(
    (
      random = randomOrder,
      requestedMode: PracticeMode = mode,
      recordLeavingProblem = true
    ) => {
      if (executionInFlightRef.current) return;
      if (recordLeavingProblem) {
        markCurrentProblemAttempting();
      }
      attemptContextsRef.current = {};
      editedCurrentProblemRef.current = false;
      reviewActionsRef.current = emptyReviewActionTelemetry();
      const restartedAt = new Date();
      setPersisted((previous) => {
        let recallRounds = previous.recallRounds;
        const activeRound = recordLeavingProblem
          ? activeRecallRound(recallRounds, currentId, mode)
          : undefined;
        if (activeRound) {
          recallRounds = abandonRound(recallRounds, {
            eventId: createRandomId(),
            roundId: activeRound.id,
            problemId: currentId,
            at: restartedAt
          });
        }
        const plan = previous.training.activePlan;
        const trainingWithOutcome =
          recordLeavingProblem && plan
            ? trainingProgramWithCompletedPlan(
                previous.training,
                recordTrainingProblemOutcome(plan, {
                  mode,
                  activeProblemId: currentId,
                  outcome: "abandoned",
                  occurredAt: restartedAt
                })
              )
            : previous.training;
        return {
          ...previous,
          recallRounds,
          training: programWithPausedTraining(trainingWithOutcome),
          settings: {
            ...previous.settings,
            answerOpen: false,
            answerReferenceOpen: false,
            explanationOpen: false
          }
        };
      });
      setBackHistory([]);
      const candidates =
        requestedMode === "explore"
          ? explorationProblems
          : requestedMode === "repeat"
            ? repeatEligibleProblems
            : filteredProblems;
      sessionRevisionRef.current += 1;
      if (!candidates.length) {
        setQueue([]);
        setSessionGoal(0);
        setResults([]);
        setSubmitted(false);
        if (requestedMode === "repeat") {
          updateRepeatSession(() => emptyRepeatSession());
        }
        return;
      }
      const source = sessionProblemsForMode(
        requestedMode,
        requestedMode === "explore" ? shuffled(candidates) : candidates,
        persistedRef.current.records,
        {
          now: new Date(),
          randomize: random,
          allowEarly: requestedMode === "free",
          recentProblemIds: backHistory
        }
      );
      if (!source.length) {
        setQueue([]);
        setSessionGoal(0);
        setResults([]);
        setSubmitted(false);
        if (requestedMode === "repeat") {
          updateRepeatSession(() => emptyRepeatSession());
          setRepeatFeedback({
            kind: "failure",
            message: "目前沒有到期、retry 或可開始的新題；未到期舊題不會提前重複"
          });
        }
        return;
      }
      const size = persistedRef.current.settings.sessionSize;
      const selected = size === 0 ? source : source.slice(0, size);
      startFreshEditorEntry();
      setQueue(selected.map((item) => item.id));
      setSessionGoal(selected.length);
      setResults([]);
      setSubmitted(false);
      setSessionStats({
        attempted: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        totalMs: 0
      });
      const now = Date.now();
      setSessionStartedAt(now);
      resetProblemTimer();
      if (requestedMode === "repeat") {
        updateRepeatSession(() => ({
          ...emptyRepeatSession(),
          phase: "running",
          total: selected.length
        }));
        setRepeatFeedback(null);
      }
    },
    [
      explorationProblems,
      backHistory,
      currentId,
      filteredProblems,
      markCurrentProblemAttempting,
      mode,
      randomOrder,
      repeatEligibleProblems,
      resetProblemTimer,
      startFreshEditorEntry,
      updateRepeatSession
    ]
  );

  const startSpeedChallenge = useCallback(() => {
    if (executionInFlightRef.current) return;

    markCurrentProblemAttempting();
    attemptContextsRef.current = {};
    editedCurrentProblemRef.current = false;
    reviewActionsRef.current = emptyReviewActionTelemetry();
    reviewActionsRef.current = {
      ...reviewActionsRef.current,
      answerRevealCount: Number(
        persistedRef.current.settings.speedAnswerVisible
      )
    };
    setBackHistory([]);
    sessionRevisionRef.current += 1;

    const size = persistedRef.current.settings.sessionSize;
    const readyProblems = speedReadyProblemsRef.current;
    const selected =
      size === 0 ? readyProblems : readyProblems.slice(0, size);
    if (!selected.length) {
      updateSpeedSession(() => emptySpeedSession());
      setSpeedFeedback({
        kind: "failure",
        message: "目前篩選題組沒有可執行的測資題目"
      });
      setQueue([]);
      setSessionGoal(0);
      return;
    }

    startFreshEditorEntry();
    setQueue(selected.map((item) => item.id));
    setSessionGoal(selected.length);
    setResults([]);
    setSubmitted(false);
    setSessionStats({
      attempted: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      totalMs: 0
    });
    setSessionStartedAt(Date.now());
    resetProblemTimer();
    const questionLimitMs = speedQuestionLimitMs(
      persistedRef.current.settings.speedQuestionSeconds
    );
    updateSpeedSession(() => ({
      ...emptySpeedSession(questionLimitMs),
      phase: "running",
      total: selected.length
    }));
    setSpeedFeedback(null);
    setPersisted((previous) => ({
      ...previous,
      training: programWithPausedTraining(previous.training),
      settings: {
        ...previous.settings,
        ...speedAnswerPolicy(previous.settings.speedAnswerVisible)
      }
    }));
  }, [
    markCurrentProblemAttempting,
    resetProblemTimer,
    startFreshEditorEntry,
    updateSpeedSession
  ]);

  useEffect(() => {
    if (!hydrated || tabRole !== "primary") return;
    setPersisted((previous) => {
      const current = previous.settings.filters;
      if (
        current.query === filters.query &&
        current.category === filters.category &&
        current.source === filters.source &&
        current.difficulty === filters.difficulty &&
        current.status === filters.status
      ) {
        return previous;
      }
      return {
        ...previous,
        settings: {
          ...previous.settings,
          filters
        }
      };
    });
  }, [filters, hydrated, tabRole]);

  // Review mode opens ready-to-code instead of stopping at a setup screen.
  useEffect(() => {
    if (
      !hydrated ||
      tabRole !== "primary" ||
      !indexData ||
      initialSessionHandledRef.current
    ) {
      return;
    }
    initialSessionHandledRef.current = true;
    const validProblemIds = new Set(
      indexData.problems.map((item) => item.id)
    );
    const restoredTrainingPlan = trainingPlanForDate(
      persistedRef.current.training,
      trainingDateKey()
    );
    const restoredTrainingBlock = currentTrainingBlock(
      restoredTrainingPlan ?? undefined
    );
    if (restoredTrainingPlan?.status === "running" && restoredTrainingBlock) {
      const remaining = normalizePracticeQueue(
        restoredTrainingBlock.remainingProblemIds,
        validProblemIds
      );
      if (remaining.length > 0) {
        setPersisted((previous) => ({
          ...previous,
          training: {
            ...previous.training,
            activePlan: restoredTrainingPlan
          },
          settings: {
            ...previous.settings,
            mode: restoredTrainingBlock.mode
          }
        }));
        setQueue(remaining);
        setSessionGoal(remaining.length);
        return;
      }
    }
    if (
      restoredTrainingPlan &&
      (restoredTrainingPlan.status === "ready" ||
        restoredTrainingPlan.status === "paused" ||
        restoredTrainingPlan.status === "completed")
    ) {
      setPersisted((previous) => ({
        ...previous,
        training: {
          ...previous.training,
          activePlan: restoredTrainingPlan
        }
      }));
      setQueue([]);
      setSessionGoal(0);
      setTrainingMenuOpen(true);
      return;
    }
    const restoredQueue = normalizePracticeQueue(queue, validProblemIds);
    if (persistedRef.current.settings.mode === "speed") {
      const restoredSpeed = speedSessionRef.current;
      const canResume =
        restoredQueue.length > 0 &&
        (restoredSpeed.phase === "running" ||
          restoredSpeed.phase === "timeout");
      if (canResume) {
        setQueue(restoredQueue);
        setSessionGoal((current) =>
          Math.max(current, restoredSpeed.total, restoredQueue.length)
        );
        return;
      }
      setQueue([]);
      setSessionGoal(0);
      updateSpeedSession(() => emptySpeedSession());
      return;
    }
    if (persistedRef.current.settings.mode === "repeat") {
      const restoredRepeat = repeatSessionRef.current;
      const canResume =
        restoredQueue.length > 0 && restoredRepeat.phase === "running";
      if (canResume) {
        setQueue(restoredQueue);
        setSessionGoal((current) =>
          Math.max(current, restoredRepeat.total, restoredQueue.length)
        );
        return;
      }
      setQueue([]);
      setSessionGoal(0);
      updateRepeatSession(() => emptyRepeatSession());
      return;
    }
    const restoredMode = persistedRef.current.settings.mode;
    const candidates =
      restoredMode === "explore" ? explorationProblems : filteredProblems;
    const eligible = sessionProblemsForMode(
      restoredMode,
      restoredMode === "explore" ? shuffled(candidates) : candidates,
      persistedRef.current.records,
      {
        now: new Date(),
        randomize: persistedRef.current.settings.randomOrder,
        allowEarly: restoredMode === "free",
        recentProblemIds: backHistory
      }
    );
    const eligibleIds = new Set(eligible.map((item) => item.id));
    const compatibleQueue = restoredQueue.filter((id) => eligibleIds.has(id));
    if (compatibleQueue.length > 0) {
      setQueue(compatibleQueue);
      setSessionGoal((current) => Math.max(current, compatibleQueue.length));
      return;
    }
    const initialSource = eligible;
    const initial = initialSource
      .slice(0, persistedRef.current.settings.sessionSize || undefined)
      .map((item) => item.id);
    setQueue(initial);
    setSessionGoal(initial.length);
    const now = Date.now();
    setSessionStartedAt(now);
    resetProblemTimer();
  }, [
    backHistory,
    hydrated,
    indexData,
    explorationProblems,
    filteredProblems,
    queue.length,
    resetProblemTimer,
    tabRole,
    updateRepeatSession,
    updateSpeedSession
  ]);

  useEffect(() => {
    if (
      !hydrated ||
      tabRole !== "primary" ||
      !initialSessionHandledRef.current ||
      queue.length === 0 ||
      (mode !== "guided" && mode !== "free") ||
      persisted.training.activePlan?.status === "running"
    ) {
      return;
    }
    const nextQueue = insertDueReviewsAfterCurrent(
      filteredProblems,
      persisted.records,
      queue,
      persisted.settings.sessionSize,
      new Date(clockNow)
    );
    const unchanged =
      nextQueue.length === queue.length &&
      nextQueue.every((id, index) => id === queue[index]);
    if (!unchanged) {
      setQueue(nextQueue);
      setSessionGoal((current) => Math.max(current, nextQueue.length));
    }
  }, [
    clockNow,
    filteredProblems,
    hydrated,
    mode,
    persisted.records,
    persisted.settings.sessionSize,
    persisted.training.activePlan?.status,
    queue,
    tabRole
  ]);

  useEffect(() => {
    if (!hydrated || tabRole !== "primary") return;
    setPersisted((previous) => ({
      ...previous,
      session: {
        queue,
        currentProblemId: currentId || undefined,
        results,
        submitted,
        initialTotal: sessionGoal,
        startedAt: sessionStartedAt,
        problemTimer,
        backHistory,
        speed: speedSession,
        repeat: repeatSession,
        ...sessionStats
      }
    }));
  }, [
    hydrated,
    backHistory,
    currentId,
    problemTimer,
    queue,
    results,
    sessionGoal,
    sessionStartedAt,
    sessionStats,
    speedSession,
    submitted,
    repeatSession,
    tabRole
  ]);

  useEffect(() => {
    if (!currentId) {
      setProblem(null);
      setProblemLoadError(null);
      setResults([]);
      setSubmitted(false);
      setNoteDraft("");
      latestNoteRef.current = null;
      setNoteSaveStatus("saved");
      activeProblemIdRef.current = "";
      resetProblemTimer();
      return;
    }
    const entryMode = nextEditorEntryModeRef.current;
    nextEditorEntryModeRef.current = "resume-draft";
    const startWithFreshSkeleton = entryMode === "fresh-skeleton";
    const restoringCurrentProblem =
      activeProblemIdRef.current === "" &&
      persistedRef.current.session.queue[0] === currentId;
    activeProblemIdRef.current = currentId;
    const savedNote = persistedRef.current.notes[currentId] ?? "";
    latestNoteRef.current = { id: currentId, value: savedNote };
    setNoteDraft(savedNote);
    setNoteSaveStatus("saved");
    editedCurrentProblemRef.current = false;
    const settings = persistedRef.current.settings;
    if (startWithFreshSkeleton) {
      delete attemptContextsRef.current[currentId];
    }
    const restoredContext = startWithFreshSkeleton
      ? undefined
      : attemptContextsRef.current[currentId];
    // Speed 依 speedAnswerPolicy 決定每題開場是否顯示答案（跟打），
    // 重新整理復原同一題時也要保留使用者原本開著的面板。
    const preservesAnswerPanels =
      settings.mode === "speed" || restoringCurrentProblem;
    reviewActionsRef.current =
      restoredContext?.actions ?? {
        ...emptyReviewActionTelemetry(),
        answerRevealCount:
          preservesAnswerPanels && settings.mode !== "interview"
            ? Number(settings.answerOpen) +
              Number(settings.explanationOpen)
            : 0
      };
    if (
      !preservesAnswerPanels &&
      (settings.answerOpen ||
        settings.answerReferenceOpen ||
        settings.explanationOpen)
    ) {
      // 答案顯示是全域持久設定；換題必須關閉，否則上一題開過的
      // 答案會殘留到下一題，讓它被誤判為看答案完成而拿不到 FSRS 排程。
      setPersisted((previous) => ({
        ...previous,
        settings: {
          ...previous.settings,
          answerOpen: false,
          answerReferenceOpen: false,
          explanationOpen: false
        }
      }));
    }
    setProblem(null);
    setProblemLoadError(null);
    setResetControlsOpen(false);
    if (!restoringCurrentProblem || startWithFreshSkeleton) {
      const restoredTimer =
        restoredContext?.timer ?? emptyAttemptTimer();
      problemTimerRef.current = restoredTimer;
      setProblemTimer(restoredTimer);
      setClockNow(Date.now());
    }

    let cancelled = false;
    fetch(`/data/problems/${currentId}.json`)
      .then((response) => {
        if (!response.ok) throw new Error("題目載入失敗");
        return response.json();
      })
      .then((detail: ProblemDetail) => {
        if (cancelled) return;
        setProblem(detail);
        const savedDraft = startWithFreshSkeleton
          ? undefined
          : persistedRef.current.drafts[currentId];
        const restoredCode = editorCodeForDraft(savedDraft, detail.starter);
        codeRef.current = restoredCode;
        latestDraftRef.current = { id: currentId, value: restoredCode };
        setCode(restoredCode);
        setEditorRevision((value) => value + 1);
        const canRestoreResults =
          restoringCurrentProblem &&
          persistedRef.current.session.currentProblemId === currentId;
        setResults(
          canRestoreResults
            ? persistedRef.current.session.results
            : []
        );
        setSubmitted(
          canRestoreResults
            ? persistedRef.current.session.submitted
            : false
        );
        setAnswerControlsOpen(false);
        setFormatControlsOpen(false);
        setFormatFeedback(null);
        setAnswerRevealSeed(0);
        setProblemHistoryOpen(false);
        setShowCustomTest(false);
        setCustomInput("");
        setCustomExpected("");

        if (startWithFreshSkeleton) {
          setPersisted((previous) => {
            if (previous.drafts[currentId] === detail.starter) {
              return previous;
            }
            return {
              ...previous,
              drafts: {
                ...previous.drafts,
                [currentId]: detail.starter
              }
            };
          });
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          setProblemLoadError(
            "題目資料載入失敗，請確認網路連線後再試一次。"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    currentId,
    editorEntryRevision,
    problemLoadAttempt,
    resetProblemTimer,
    setPersisted
  ]);

  useEffect(() => {
    if (
      tabRole !== "secondary" ||
      !problem ||
      problem.id !== currentId
    ) {
      return;
    }

    const syncedCode = editorCodeForDraft(
      persisted.drafts[currentId],
      problem.starter
    );
    if (syncedCode !== codeRef.current) {
      codeRef.current = syncedCode;
      latestDraftRef.current = {
        id: currentId,
        value: syncedCode
      };
      setCode(syncedCode);
      setEditorRevision((value) => value + 1);
    }

    const syncedNote = persisted.notes[currentId] ?? "";
    if (syncedNote !== latestNoteRef.current?.value) {
      latestNoteRef.current = {
        id: currentId,
        value: syncedNote
      };
      setNoteDraft(syncedNote);
      setNoteSaveStatus("saved");
    }
  }, [
    currentId,
    persisted.drafts,
    persisted.notes,
    problem,
    tabRole
  ]);

  useEffect(() => {
    // 秒級顯示（作答計時、面試倒數、Speed 倒數）由自帶 interval 的
    // 子元件負責；父層的 clockNow 只剩分鐘級的邏輯與統計在用
    // （due 數、speed 候選、FSRS 顯示），30 秒更新一次就夠，
    // 避免整棵元件樹每秒全量重渲染。Speed 逾時判定走 deadline 的
    // setTimeout（見 expireSpeedQuestion），與這個 tick 無關。
    const timer = window.setInterval(() => {
      setClockNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // 題目資料真正進來後才開始本輪設定的秒數；網路載入不算作答時間。
  useEffect(() => {
    if (
      mode !== "speed" ||
      speedSession.phase !== "running" ||
      !currentId ||
      !problem ||
      problem.id !== currentId ||
      speedSession.questionId === currentId
    ) {
      return;
    }

    const startedAt = Date.now();
    updateSpeedSession((current) => ({
      ...current,
      questionId: currentId,
      deadlineAt: startedAt + current.questionLimitMs
    }));
    setClockNow(startedAt);
  }, [
    currentId,
    mode,
    problem,
    speedSession.phase,
    speedSession.questionId,
    updateSpeedSession
  ]);

  const commitLatestDraft = useCallback(() => {
    const latest = latestDraftRef.current;
    if (!latest) return;
    setPersisted((previous) => ({
      ...previous,
      drafts: { ...previous.drafts, [latest.id]: latest.value }
    }));
  }, []);

  const snapshotWithLatestEdits = useCallback((): PersistedState => {
    const snapshot = persistedRef.current;
    const latestDraft = latestDraftRef.current;
    const latestNote = latestNoteRef.current;
    const notes = { ...snapshot.notes };
    if (latestNote) {
      if (latestNote.value.trim()) {
        notes[latestNote.id] = latestNote.value;
      } else {
        delete notes[latestNote.id];
      }
    }
    return {
      ...snapshot,
      drafts: latestDraft
        ? {
            ...snapshot.drafts,
            [latestDraft.id]: latestDraft.value
          }
        : snapshot.drafts,
      notes,
      session: {
        ...snapshot.session,
        queue,
        backHistory,
        currentProblemId: queue[0] || undefined,
        results,
        submitted,
        initialTotal: sessionGoal,
        startedAt: sessionStartedAt,
        problemTimer: pauseAttempt(
          problemTimerRef.current,
          Date.now()
        ),
        speed: speedSessionRef.current,
        repeat: repeatSessionRef.current,
        ...sessionStats
      },
      settings: {
        ...snapshot.settings,
        filters,
        interviewMinutes,
        randomOrder
      }
    };
  }, [
    backHistory,
    filters,
    interviewMinutes,
    queue,
    randomOrder,
    results,
    sessionGoal,
    sessionStartedAt,
    sessionStats,
    submitted
  ]);

  const downloadDatabaseBackup = useCallback(async () => {
    try {
      setDatabaseStatus("saving");
      setDatabaseMessage("正在建立 SQLite 備份");
      const snapshot = snapshotWithLatestEdits();
      const savedAt = nextStateSaveTimestamp();
      saveState(snapshot, savedAt);
      await saveStateToDatabase(snapshot, false, savedAt);

      const response = await fetch("/api/backup", { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "資料庫備份失敗");
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename =
        disposition.match(/filename="([^"]+)"/)?.[1] ??
        "recode-backup.sqlite3";
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      setDatabaseStatus("saved");
      setDatabaseMessage(`備份已下載：${filename}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "資料庫備份失敗";
      setDatabaseStatus("error");
      setDatabaseMessage(message);
      window.alert(message);
    }
  }, [snapshotWithLatestEdits]);

  const restoreDatabaseBackup = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;
      if (
        !window.confirm(
          `要用「${file.name}」覆蓋目前進度嗎？還原前建議先下載一份目前備份。`
        )
      ) {
        return;
      }

      try {
        if (databaseTimerRef.current) {
          clearTimeout(databaseTimerRef.current);
          databaseTimerRef.current = null;
        }
        setDatabaseStatus("saving");
        setDatabaseMessage(`正在還原：${file.name}`);
        const savedAt = nextStateSaveTimestamp();
        const response = await fetch("/api/restore", {
          method: "POST",
          headers: {
            "Content-Type": "application/vnd.sqlite3",
            "X-Recode-Saved-At": String(savedAt)
          },
          body: file
        });
        const payload = (await response.json()) as {
          state?: unknown;
          error?: string;
        };
        if (!response.ok || !payload.state) {
          throw new Error(payload.error ?? "資料庫還原失敗");
        }

        const restored = normalizeState(payload.state);
        saveState(restored, savedAt);
        persistedRef.current = restored;
        setDatabaseStatus("saved");
        setDatabaseMessage(`已還原：${file.name}`);
        window.location.reload();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "資料庫還原失敗";
        setDatabaseStatus("error");
        setDatabaseMessage(message);
        window.alert(message);
      }
    },
    []
  );

  const handleCodeChange = useCallback(
    (value: string) => {
      if (!currentId) return;
      if (!formattingInFlightRef.current) {
        setFormatFeedback(null);
      }
      editedCurrentProblemRef.current = true;
      const now = Date.now();
      ensureRecallRound(new Date(now));
      // beginOrResumeAttempt 在計時中會回傳同一個物件，所以打字期間
      // 不再觸發父層 setState；計時顯示由 AttemptTimerDisplay 自己跳秒。
      updateProblemTimer((current) =>
        beginOrResumeAttempt(current, now)
      );
      codeRef.current = value;
      latestDraftRef.current = { id: currentId, value };
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(commitLatestDraft, 350);
    },
    [commitLatestDraft, currentId, ensureRecallRound, updateProblemTimer]
  );

  const handleFormatStart = useCallback(() => {
    formattingInFlightRef.current = true;
    setFormatting(true);
    setFormatFeedback(null);
  }, []);

  const handleFormatResult = useCallback(
    (result: PythonFormatResult) => {
      formattingInFlightRef.current = false;
      setFormatting(false);
      setFormatFeedback(result);
    },
    []
  );

  const formatCurrentCode = useCallback(async () => {
    if (formattingInFlightRef.current) return null;
    const result = await codeEditorRef.current?.formatDocument();
    if (!result) {
      const unavailable: PythonFormatResult = {
        status: "error",
        code: codeRef.current,
        message: "格式化失敗：編輯器尚未載入完成"
      };
      handleFormatResult(unavailable);
      return unavailable;
    }
    return result;
  }, [handleFormatResult]);

  const handleNoteChange = useCallback(
    (value: string) => {
      if (!currentId) return;
      setNoteDraft(value);
      setNoteSaveStatus("saving");
      latestNoteRef.current = { id: currentId, value };
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      noteTimerRef.current = setTimeout(commitLatestNote, 500);
    },
    [commitLatestNote, currentId]
  );

  const handleNoteKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Tab") {
        event.preventDefault();
        const textarea = event.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const next =
          noteDraft.slice(0, start) + "  " + noteDraft.slice(end);
        handleNoteChange(next);
        window.requestAnimationFrame(() => {
          textarea.selectionStart = start + 2;
          textarea.selectionEnd = start + 2;
        });
        return;
      }

      if (
        event.key === "Enter" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        event.stopPropagation();
        commitLatestNote();
        setNoteView("preview");
      }
    },
    [commitLatestNote, handleNoteChange, noteDraft]
  );

  useEffect(() => {
    const flush = () => {
      if (tabRoleRef.current !== "primary") return;
      const stateWithLatestEdits = snapshotWithLatestEdits();
      const savedAt = nextStateSaveTimestamp();
      saveState(stateWithLatestEdits, savedAt);
      void saveStateToDatabase(
        stateWithLatestEdits,
        true,
        savedAt
      ).catch(() => {
        // localStorage remains the crash-safe fallback and will sync next time.
      });
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", visibility);
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
    };
  }, [snapshotWithLatestEdits]);

  useEffect(() => {
    if (!dragging) return;
    const move = (event: MouseEvent) => {
      const box = workspaceRef.current?.getBoundingClientRect();
      if (!box) return;
      const percent = Math.min(
        66,
        Math.max(30, ((event.clientX - box.left) / box.width) * 100)
      );
      setPersisted((previous) => ({
        ...previous,
        settings: { ...previous.settings, leftPercent: percent }
      }));
    };
    const stop = () => setDragging(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
  }, [dragging]);

  useEffect(() => {
    if (!resizingEditor) return;

    const resize = (event: PointerEvent) => {
      const nextHeight =
        editorResizeStartRef.current.height +
        event.clientY -
        editorResizeStartRef.current.y;
      setPersisted((previous) => ({
        ...previous,
        settings: {
          ...previous.settings,
          editorHeight: Math.min(1000, Math.max(300, nextHeight))
        }
      }));
    };
    const stop = () => setResizingEditor(false);

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [resizingEditor]);

  useEffect(() => {
    if (!persisted.settings.sidebarOpen) return;

    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        sidebarRef.current?.contains(target) ||
        sidebarToggleRef.current?.contains(target)
      ) {
        return;
      }
      setPersisted((previous) => ({
        ...previous,
        settings: {
          ...previous.settings,
          sidebarOpen: false
        }
      }));
    };

    document.addEventListener("pointerdown", closeFromOutside, true);
    return () =>
      document.removeEventListener("pointerdown", closeFromOutside, true);
  }, [persisted.settings.sidebarOpen]);

  const updateRecord = useCallback(
    (id: string, updater: (record: StudyRecord) => StudyRecord) => {
      setPersisted((previous) => ({
        ...previous,
        records: {
          ...previous.records,
          [id]: updater(recordFor(previous, id))
        }
      }));
    },
    []
  );

  const recordEditorTelemetry = useCallback(
    (delta: {
      insertedChars: number;
      deletedChars: number;
      editOperations: number;
    }) => {
      const current = reviewActionsRef.current;
      reviewActionsRef.current = {
        ...current,
        insertedChars:
          current.insertedChars + Math.max(0, delta.insertedChars),
        deletedChars:
          current.deletedChars + Math.max(0, delta.deletedChars),
        editOperations:
          current.editOperations + Math.max(0, delta.editOperations)
      };
    },
    []
  );

  const recordHintUse = useCallback(() => {
    if (!currentId) return;
    ensureRecallRound();
    reviewActionsRef.current = {
      ...reviewActionsRef.current,
      hintsUsed: reviewActionsRef.current.hintsUsed + 1
    };
    updateRecord(currentId, (record) => ({
      ...record,
      hints: record.hints + 1
    }));
  }, [currentId, ensureRecallRound, updateRecord]);

  const recordAnswerReveal = useCallback(() => {
    if (!currentId) return;
    const active = activeRecallRound(
      persistedRef.current.recallRounds,
      currentId,
      mode
    );
    if (
      !active &&
      submitted &&
      results.length > 0 &&
      results.every((result) => result.passed)
    ) {
      // 交卷後查看解析不應倒灌成一個新的「未完成回想回合」。
      return;
    }
    markCurrentRecallAssisted();
    reviewActionsRef.current = {
      ...reviewActionsRef.current,
      answerRevealCount:
        reviewActionsRef.current.answerRevealCount + 1
    };
  }, [currentId, markCurrentRecallAssisted, mode, results, submitted]);

  const expireSpeedQuestion = useCallback(() => {
    const currentSpeed = speedSessionRef.current;
    if (executionInFlightRef.current) {
      // 使用者在截止前已按送出時，先讓 runner 結束再判斷，避免執行時間
      // 把原本準時的答案誤判成逾時。
      window.setTimeout(() => expireSpeedQuestion(), 80);
      return;
    }
    if (
      mode !== "speed" ||
      currentSpeed.phase !== "running" ||
      !currentSpeed.deadlineAt ||
      currentSpeed.questionId !== currentId ||
      !problem ||
      problem.id !== currentId
    ) {
      return;
    }

    const now = Date.now();
    if (now < currentSpeed.deadlineAt) {
      // 瀏覽器的 timeout 偶爾會比 deadline 早一點被喚醒；不能直接 return，
      // 否則這一關永遠不會進入逾時狀態。
      window.setTimeout(
        () => expireSpeedQuestion(),
        Math.max(16, currentSpeed.deadlineAt - now)
      );
      return;
    }

    const timedOutAt = new Date();
    markCurrentRecallAssisted(timedOutAt, "speed-timeout-rewrite");
    updateSpeedSession((current) => ({
      ...current,
      phase: "timeout",
      timedOut: current.timedOut + 1,
      categories: nextSpeedCategoryStats(current.categories, problem.category, {
        timedOut: 1
      })
    }));
    reviewActionsRef.current = {
      ...reviewActionsRef.current,
      answerRevealCount: reviewActionsRef.current.answerRevealCount + 1
    };
    updateRecord(currentId, (record) => ({
      ...record,
      status: statusAfterSubmissionEvidence({
        currentStatus: record.status,
        passed: false,
        memoryEligible: false,
        acceptedStatus: record.status
      }),
      lastStudiedAt: timedOutAt.toISOString()
    }));
    resetProblemTimer();
    setSpeedFeedback({
      kind: "timeout",
      message: "時間到：答案已開啟；本次只算訓練，不更新 FSRS"
    });
    setPersisted((previous) => ({
      ...previous,
      settings: {
        ...previous.settings,
        answerOpen: true,
        answerReferenceOpen: true,
        explanationOpen: false
      }
    }));
  }, [
    currentId,
    mode,
    markCurrentRecallAssisted,
    problem,
    resetProblemTimer,
    updateRecord,
    updateSpeedSession
  ]);

  useEffect(() => {
    if (
      mode !== "speed" ||
      speedSession.phase !== "running" ||
      !speedSession.deadlineAt ||
      speedSession.questionId !== currentId
    ) {
      return;
    }

    const delay = Math.max(0, speedSession.deadlineAt - Date.now());
    const timeout = window.setTimeout(expireSpeedQuestion, delay);
    return () => window.clearTimeout(timeout);
  }, [
    currentId,
    ensureRecallRound,
    expireSpeedQuestion,
    mode,
    speedSession.deadlineAt,
    speedSession.phase,
    speedSession.questionId
  ]);

  useEffect(() => {
    if (
      mode !== "speed" ||
      speedSession.phase !== "running" ||
      speedSession.total === 0 ||
      currentId
    ) {
      return;
    }
    updateSpeedSession((current) => ({
      ...current,
      phase: "finished",
      deadlineAt: undefined,
      questionId: undefined
    }));
    setSpeedFeedback(null);
  }, [
    currentId,
    mode,
    speedSession.phase,
    speedSession.total,
    updateSpeedSession
  ]);

  useEffect(() => {
    if (
      mode !== "repeat" ||
      repeatSession.phase !== "running" ||
      repeatSession.total === 0 ||
      currentId
    ) {
      return;
    }
    updateRepeatSession((current) => ({
      ...current,
      phase: "finished",
      stage: 0
    }));
  }, [
    currentId,
    mode,
    repeatSession.phase,
    repeatSession.total,
    updateRepeatSession
  ]);

  const moveToNext = useCallback(
    (
      outcome: "completed" | "deferred" | "skipped" | "left" =
        "completed",
      trainingCompleted = outcome === "completed"
    ) => {
      commitLatestNote();
      const occurredAt = new Date();
      if (currentId) {
        setPersisted((previous) => {
          let recallRounds = previous.recallRounds;
          const activeRound = activeRecallRound(
            recallRounds,
            currentId,
            mode
          );
          if (activeRound && outcome !== "completed") {
            recallRounds = deferRound(recallRounds, {
              eventId: createRandomId(),
              roundId: activeRound.id,
              problemId: currentId,
              at: occurredAt
            });
          }

          let training = previous.training;
          const plan = training.activePlan;
          if (plan) {
            const planOutcome = trainingCompleted
              ? "completed"
              : outcome === "skipped"
                ? "skipped"
                : "left";
            const nextPlan = recordTrainingProblemOutcome(plan, {
              mode,
              activeProblemId: currentId,
              ...(trainingCompleted
                ? { completedProblemId: currentId }
                : {}),
              outcome: planOutcome,
              occurredAt
            });
            training = trainingProgramWithCompletedPlan(
              training,
              nextPlan
            );
          }

          if (
            recallRounds === previous.recallRounds &&
            training === previous.training
          ) {
            return previous;
          }
          return { ...previous, recallRounds, training };
        });
      }
      if (currentId) {
        setBackHistory((history) =>
          rememberPracticeProblem(history, currentId)
        );
      }
      startFreshEditorEntry();
      // 導覽永遠消耗目前 queue 項目。未完成題保留在 Daily Training
      // 的 remainingProblemIds，稍後明確恢復；不能在同一輪尾端無限循環。
      setQueue((previous) => advancePracticeQueue(previous, false));
      setResults([]);
      setSubmitted(false);
    },
    [commitLatestNote, currentId, mode, setPersisted, startFreshEditorEntry]
  );

  const restoreCurrentEditor = useCallback((preserveTimer = false) => {
    if (!problem) return;

    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    editedCurrentProblemRef.current = false;
    codeRef.current = problem.starter;
    latestDraftRef.current = {
      id: problem.id,
      value: problem.starter
    };
    setCode(problem.starter);
    setEditorRevision((value) => value + 1);
    setResults([]);
    setSubmitted(false);
    setProblemHistoryOpen(false);
    setResetControlsOpen(false);
    if (!preserveTimer) resetProblemTimer();
  }, [problem, resetProblemTimer]);

  const resetCurrentCode = useCallback(() => {
    if (
      !problem ||
      problem.id !== currentId ||
      executionInFlightRef.current
    ) {
      return;
    }
    reviewActionsRef.current = {
      ...reviewActionsRef.current,
      resetCount: reviewActionsRef.current.resetCount + 1
    };
    restoreCurrentEditor(true);

    setPersisted((previous) => {
      const record = recordFor(previous, problem.id);
      const nextStatus = statusAfterResettingProblem(record);
      return {
        ...previous,
        drafts: {
          ...previous.drafts,
          [problem.id]: problem.starter
        },
        records:
          nextStatus === record.status
            ? previous.records
            : {
                ...previous.records,
                [problem.id]: {
                  ...record,
                  status: nextStatus
                }
              }
      };
    });
  }, [currentId, problem, restoreCurrentEditor]);

  const clearCurrentProblemHistory = useCallback(() => {
    if (
      !problem ||
      problem.id !== currentId ||
      executionInFlightRef.current
    ) {
      return;
    }
    const confirmed = window.confirm(
      `確定清除「${problem.identity} ${problem.title}」的全部紀錄？\n\n` +
        "會刪除本題草稿、提交程式碼、AC／錯誤次數、作答時間與複習排程；此動作無法復原。"
    );
    if (!confirmed) return;

    const currentSessionSubmissions =
      persistedRef.current.submissionHistory.filter(
        (event) =>
          event.problemId === problem.id &&
          Date.parse(event.submittedAt) >= sessionStartedAt
      );
    const removedPassed = currentSessionSubmissions.filter(
      (event) => event.passed
    ).length;
    const removedFailed =
      currentSessionSubmissions.length - removedPassed;
    const removedMs = currentSessionSubmissions.reduce(
      (total, event) => total + event.durationMs,
      0
    );

    restoreCurrentEditor();
    delete attemptContextsRef.current[problem.id];
    reviewActionsRef.current = emptyReviewActionTelemetry();
    setSessionStats((previous) => ({
      ...previous,
      attempted: Math.max(
        0,
        previous.attempted - currentSessionSubmissions.length
      ),
      passed: Math.max(0, previous.passed - removedPassed),
      failed: Math.max(0, previous.failed - removedFailed),
      totalMs: Math.max(0, previous.totalMs - removedMs)
    }));
    setPersisted((previous) => {
      const currentRecord = recordFor(previous, problem.id);
      const cleared = removeProblemSubmissions(
        previous.activity,
        previous.submissionHistory,
        problem.id,
        currentRecord
      );
      return {
        ...previous,
        activity: cleared.activity,
        submissionHistory: cleared.submissionHistory,
        recallRounds: previous.recallRounds.filter(
          (round) => round.problemId !== problem.id
        ),
        drafts: {
          ...previous.drafts,
          [problem.id]: problem.starter
        },
        records: {
          ...previous.records,
          [problem.id]: {
            ...defaultRecord(),
            ...(currentRecord.starred ? { starred: true } : {})
          }
        }
      };
    });
  }, [
    currentId,
    problem,
    restoreCurrentEditor,
    sessionStartedAt
  ]);

  const allTests = useMemo<TestCase[]>(() => {
    if (!problem) return [];
    const custom = persisted.customTests[problem.id] ?? [];
    return [...problem.tests, ...custom];
  }, [persisted.customTests, problem]);

  const execute = useCallback(async () => {
    if (
      !problem ||
      !currentId ||
      problem.id !== currentId ||
      executionInFlightRef.current ||
      formattingInFlightRef.current ||
      runnerStatus === "executing" ||
      runnerStatus === "runtime-loading"
    ) {
      return;
    }
    if (!allTests.length) {
      setShowCustomTest(true);
      setResults([
        {
          name: "需要測資",
          passed: false,
          errorType: "Runner Error",
          error: "這題沒有可自動解析的官方範例。請先新增一組輸入與預期輸出。"
        }
      ]);
      return;
    }

    let submittedCode = codeRef.current;
    if (
      shouldFormatBeforeSubmit(
        mode,
        persistedRef.current.settings.formatOnSubmit
      )
    ) {
      const formatResult = await formatCurrentCode();
      if (
        !problem ||
        problem.id !== currentId ||
        activeProblemIdRef.current !== currentId
      ) {
        return;
      }
      submittedCode =
        formatResult?.status === "formatted" ||
        formatResult?.status === "unchanged"
          ? formatResult.code
          : codeRef.current;
    }

    const recallRoundAtSubmission = ensureRecallRound();
    if (!recallRoundAtSubmission) return;
    executionInFlightRef.current = true;
    const executionSessionRevision = sessionRevisionRef.current;
    const reviewActions = { ...reviewActionsRef.current };
    // Assistance belongs to the whole recall round, not just the keystrokes
    // since the previous submit.  A WA must not "wash away" an answer that is
    // still visible (or was already revealed) before the next AC.
    const answerVisibleAtSubmission = Boolean(
      persistedRef.current.settings.answerOpen ||
        persistedRef.current.settings.answerReferenceOpen ||
        persistedRef.current.settings.explanationOpen
    );
    const effectiveReviewActions: ReviewActionTelemetry = {
      ...reviewActions,
      answerRevealCount: Math.max(
        reviewActions.answerRevealCount,
        Number(answerVisibleAtSubmission)
      )
    };
    const submittedTimer = { ...problemTimerRef.current };
    const submittedWasEdited = editedCurrentProblemRef.current;
    delete attemptContextsRef.current[currentId];
    reviewActionsRef.current = emptyReviewActionTelemetry();
    editedCurrentProblemRef.current = false;
    commitLatestDraft();
    commitLatestNote();
    setResults([]);
    const submittedAt = new Date();
    const speedAtSubmission = speedSessionRef.current;
    const repeatAtSubmission = repeatSessionRef.current;
    const speedIsCurrentQuestion =
      mode === "speed" && speedAtSubmission.questionId === currentId;
    const repeatIsCurrentQuestion =
      mode === "repeat" && repeatAtSubmission.phase === "running";
    const speedSubmittedInTime = Boolean(
      speedIsCurrentQuestion &&
        speedAtSubmission.phase === "running" &&
        speedAtSubmission.deadlineAt &&
        submittedAt.getTime() <= speedAtSubmission.deadlineAt
    );
    const speedWasTimeoutRewrite = Boolean(
      speedIsCurrentQuestion && speedAtSubmission.phase === "timeout"
    );
    const speedSolutionWasVisible = Boolean(
      mode === "speed" && persistedRef.current.settings.speedAnswerVisible
    );
    const speedSubmittedLate = Boolean(
      speedIsCurrentQuestion &&
        speedAtSubmission.phase === "running" &&
        !speedSubmittedInTime
    );
    const speedCanAdvance =
      mode !== "speed" ||
      speedSubmissionCanAdvance({
        submittedInTime: speedSubmittedInTime,
        timeoutRewrite: speedWasTimeoutRewrite,
        solutionVisible: speedSolutionWasVisible
      });
    const elapsed = attemptElapsedMs(
      problemTimerRef.current,
      submittedAt.getTime()
    );
    resetProblemTimer();
    let nextResults: TestResult[];
    try {
      nextResults = await run(
        submittedCode,
        allTests,
        problem.unorderedOutput
      );
    } catch (error) {
      nextResults = [
        {
          name: "執行器",
          passed: false,
          errorType: "Runner Error",
          error:
            error instanceof Error
              ? error.message
              : "Python 執行器發生未知錯誤"
        }
      ];
    } finally {
      executionInFlightRef.current = false;
    }
    const passed = nextResults.length > 0 && nextResults.every((item) => item.passed);
    const repeatTransition = repeatIsCurrentQuestion
      ? repeatSubmissionTransition(repeatAtSubmission, passed)
      : null;
    const fallbackReviewOrigin = reviewOriginForRecord(
      persistedRef.current.records[currentId],
      mode,
      submittedAt
    );
    const reviewOrigin = recallRoundReviewOrigin(
      recallRoundAtSubmission.origin,
      fallbackReviewOrigin
    );
    const stillCurrent =
      activeProblemIdRef.current === currentId &&
      sessionRevisionRef.current === executionSessionRevision;
    const runnerFailed = hasRunnerFailure(nextResults);
    if (runnerFailed) {
      if (stillCurrent) {
        setResults(nextResults);
        reviewActionsRef.current = effectiveReviewActions;
        editedCurrentProblemRef.current = submittedWasEdited;
        const restoredTimer: AttemptTimerState = {
          started: submittedTimer.started,
          elapsedMs: elapsed
        };
        attemptContextsRef.current[currentId] = {
          timer: restoredTimer,
          actions: reviewActions
        };
        problemTimerRef.current = restoredTimer;
        setProblemTimer(restoredTimer);
      }
      return;
    }
    // Keep only the sticky assistance bit between ordinary submissions. Other
    // telemetry is already stored on the submission event and will be summed
    // by assessAcceptedSubmission; carrying it again would double-count it.
    if (effectiveReviewActions.answerRevealCount > 0) {
      reviewActionsRef.current = {
        ...emptyReviewActionTelemetry(),
        answerRevealCount: effectiveReviewActions.answerRevealCount
      };
    }
    if (mode === "speed" && speedIsCurrentQuestion) {
      if (passed && speedSubmittedInTime && !speedSolutionWasVisible) {
        const remainingMs = Math.max(
          0,
          (speedAtSubmission.deadlineAt ?? submittedAt.getTime()) -
            submittedAt.getTime()
        );
        const points = speedScore(
          problem.difficulty,
          remainingMs,
          speedAtSubmission.questionLimitMs
        );
        updateSpeedSession((current) => ({
          ...current,
          phase: "running",
          score: current.score + points,
          solved: current.solved + 1,
          deadlineAt: undefined,
          questionId: undefined,
          categories: nextSpeedCategoryStats(current.categories, problem.category, {
            solved: 1,
            points
          })
        }));
        setSpeedFeedback({
          kind: "success",
          message: `限時 AC +${points} 分`
        });
      } else if (
        passed &&
        (speedWasTimeoutRewrite || speedSolutionWasVisible)
      ) {
        updateSpeedSession((current) => ({
          ...current,
          phase: "running",
          deadlineAt: undefined,
          questionId: undefined
        }));
        setSpeedFeedback({
          kind: "success",
          message: speedSolutionWasVisible
            ? "跟打通過：保留練習紀錄，不更新 FSRS"
            : "重打通過：逾時與重打都不更新 FSRS"
        });
      } else if (!passed) {
        updateSpeedSession((current) => ({
          ...current,
          wrongAttempts: current.wrongAttempts + 1,
          categories: nextSpeedCategoryStats(current.categories, problem.category, {
            wrongAttempts: 1
          })
        }));
        setSpeedFeedback({
          kind: "failure",
          message: "測資未通過，倒數仍在繼續"
        });
      }
    }
    if (repeatTransition) {
      updateRepeatSession(() => repeatTransition.session);
      if (!passed) {
        setRepeatFeedback({
          kind: "failure",
          message: `第 ${repeatAtSubmission.stage + 1}/3 輪未通過，維持 ${repeatRevealPercent(repeatAtSubmission.stage)}% 提示繼續修正`
        });
      }
    }
    const submissionEvent: SubmissionEvent = {
      id: `${submittedAt.getTime()}-${currentId}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      roundId: recallRoundAtSubmission.id,
      problemId: currentId,
      submittedAt: submittedAt.toISOString(),
      passed,
      durationMs: elapsed,
      hintsUsed: effectiveReviewActions.hintsUsed,
      insertedChars: effectiveReviewActions.insertedChars,
      deletedChars: effectiveReviewActions.deletedChars,
      editOperations: effectiveReviewActions.editOperations,
      resetCount: effectiveReviewActions.resetCount,
      answerRevealCount: effectiveReviewActions.answerRevealCount,
      practiceMode: mode,
      reviewOrigin,
      code: submittedCode,
      results: nextResults.map((result) => ({ ...result }))
    };
    const memoryPolicy = submissionMemoryPolicy({
      mode,
      reviewOrigin,
      answerRevealCount: Math.max(
        effectiveReviewActions.answerRevealCount,
        Number(recallRoundAtSubmission.evidence === "assisted")
      ),
      speedSubmittedInTime,
      speedWasTimeoutRewrite,
      speedSolutionWasVisible,
      speedSubmittedLate
    });
    submissionEvent.memoryEligible = memoryPolicy.memoryEligible;
    submissionEvent.memoryEvidenceReason = memoryPolicy.reason;
    if (stillCurrent) {
      setResults(nextResults);
      setSubmitted(mode === "interview");
    }
    setPersisted((previous) => {
      const record = recordFor(previous, currentId);
      let recallRounds = recordRecallSubmission(previous.recallRounds, {
        eventId: submissionEvent.id,
        roundId: recallRoundAtSubmission.id,
        problemId: currentId,
        at: submittedAt,
        passed,
        memoryEligible: memoryPolicy.memoryEligible
      });
      const predictedRecall =
        record.fsrs?.algorithm_version === FSRS_ALGORITHM_VERSION
          ? retrievability(record.fsrs, submittedAt)
          : undefined;
      // 提交紀錄與記憶證據是兩件事。Repeat、已開答案與逾時重打
      // 都會留下歷史，但只有真正的無提示提取可以推進 FSRS。
      const assessment =
        passed && memoryPolicy.canScheduleAcceptedReview
        ? assessAcceptedSubmission(
            previous.submissionHistory,
            currentId,
            {
              durationMs: elapsed,
              difficulty: problem.difficulty,
              previousBestMs: record.bestMs,
              previousReviewAt: record.fsrs?.last_review,
              previousPasses: memoryEligiblePassCount(
                previous.submissionHistory,
                currentId
              ),
              ...effectiveReviewActions
            }
          )
        : null;
      let fsrsWriteApplied = false;
      if (assessment) {
        const beforeWriteCount =
          recallRounds.find(
            (round) => round.id === recallRoundAtSubmission.id
          )?.fsrsWriteCount ?? 0;
        const candidateRounds = recordFsrsWrite(recallRounds, {
          eventId: `${submissionEvent.id}:fsrs`,
          roundId: recallRoundAtSubmission.id,
          problemId: currentId,
          at: submittedAt
        });
        const afterWriteCount =
          candidateRounds.find(
            (round) => round.id === recallRoundAtSubmission.id
          )?.fsrsWriteCount ?? 0;
        fsrsWriteApplied = afterWriteCount > beforeWriteCount;
        recallRounds = candidateRounds;
      }
      const appliedAssessment = fsrsWriteApplied ? assessment : null;
      const rating = appliedAssessment?.rating ?? null;
      const fsrs =
        rating === null
          ? record.fsrs
          : scheduleReview(record.fsrs, rating, submittedAt);
      const submissionWithPrediction: SubmissionEvent = {
        ...submissionEvent,
        ...(predictedRecall === undefined
          ? {}
          : { predictedRecall })
      };
      const storedSubmission: SubmissionEvent = appliedAssessment
        ? {
            ...submissionWithPrediction,
            inferredRating: appliedAssessment.rating,
            reviewStruggleScore: appliedAssessment.struggleScore,
            timeRatio: appliedAssessment.timeRatio,
            rewriteRatio: appliedAssessment.rewriteRatio,
            calibrationSampleSize: appliedAssessment.calibrationSampleSize,
            calibrationBias: appliedAssessment.calibrationBias
          }
        : submissionWithPrediction;
      const submissionState = recordActivitySubmission(
        previous.activity,
        previous.submissionHistory,
        storedSubmission
      );
      const acceptedStatus: StudyStatus =
        mode === "speed" && !speedCanAdvance
          ? "retry"
          : familiarityLabel(fsrs) === "穩固"
            ? "mastered"
            : "completed";
      const nextRecord: StudyRecord = {
        ...record,
        status: statusAfterSubmissionEvidence({
          currentStatus: record.status,
          passed,
          memoryEligible: memoryPolicy.memoryEligible,
          acceptedStatus
        }),
        attempts: record.attempts + 1,
        passed: record.passed + (passed ? 1 : 0),
        memoryPassed:
          (record.memoryPassed ?? 0) +
          Number(passed && memoryPolicy.memoryEligible),
        assistedPassed:
          (record.assistedPassed ?? 0) +
          Number(passed && !memoryPolicy.memoryEligible),
        failed: record.failed + (passed ? 0 : 1),
        streak: passed ? record.streak + 1 : 0,
        totalMs: record.totalMs + elapsed,
        bestMs:
          passed && appliedAssessment?.failures === 0
          ? Math.min(
              record.bestMs ?? Number.POSITIVE_INFINITY,
              appliedAssessment.roundDurationMs
            )
          : record.bestMs,
        lastStudiedAt: submittedAt.toISOString(),
        recallCheckpointDue:
          passed && repeatTransition?.advanceProblem
            ? repeatCheckpointDue(submittedAt)
            : passed && fsrsWriteApplied
              ? undefined
              : record.recallCheckpointDue,
        fsrs
      };
      return {
        ...previous,
        ...submissionState,
        recallRounds,
        records: {
          ...previous.records,
          [currentId]: nextRecord
        },
        drafts: passed
          ? {
              ...previous.drafts,
              [currentId]: problem.starter
            }
          : previous.drafts
      };
    });
    if (passed && stillCurrent) {
      editedCurrentProblemRef.current = false;
      codeRef.current = problem.starter;
      latestDraftRef.current = {
        id: currentId,
        value: problem.starter
      };
      setCode(problem.starter);
      setEditorRevision((revision) => revision + 1);
    }
    if (sessionRevisionRef.current === executionSessionRevision) {
      setSessionStats((previous) => ({
        ...previous,
        attempted: previous.attempted + 1,
        passed:
          previous.passed +
          (passed
            ? mode === "repeat"
              ? Number(repeatTransition?.advanceProblem)
              : mode === "speed"
                ? Number(speedCanAdvance)
                : 1
            : 0),
        failed: previous.failed + (passed ? 0 : 1),
        totalMs: previous.totalMs + elapsed
      }));
    }
    if (speedSubmittedLate) {
      // 點下送出時已超過截止線：答案可以執行，但不算過關；進入重打階段。
      expireSpeedQuestion();
    }
    if (stillCurrent && repeatTransition) {
      if (repeatTransition.advanceProblem) {
        if (repeatTransition.stagePassed) {
          setRepeatFeedback({
            kind: "success",
            message: "三輪完成：30 分鐘後安排 0% 提示獨立驗收"
          });
        } else {
          setRepeatFeedback({
            kind: "failure",
            message: "本輪連續 3 次未通過：已記錄未完成並換到下一題"
          });
        }
        moveToNext(
          repeatTransition.stagePassed ? "completed" : "deferred",
          repeatTransition.stagePassed
        );
      } else if (passed) {
        setRepeatFeedback({
          kind: "success",
          message: `${repeatRevealPercent(repeatAtSubmission.stage)}% 提示輪通過，現在進入 ${repeatRevealPercent(repeatTransition.session.stage)}%`
        });
        // 同一題、下一個提示量：強制回到乾淨骨架，不帶上一輪程式碼。
        reviewActionsRef.current = emptyReviewActionTelemetry();
        startFreshEditorEntry();
        setResults([]);
        setSubmitted(false);
      }
      return;
    }
    const activePlanAtSubmission =
      persistedRef.current.training.activePlan;
    const activePlannedBlock = currentTrainingBlock(
      activePlanAtSubmission
    );
    const plannedInterviewCanAdvance =
      mode === "interview" &&
      activePlanAtSubmission?.status === "running" &&
      activePlannedBlock?.kind === "interview" &&
      activePlannedBlock.remainingProblemIds.includes(currentId);
    if (
      passed &&
      stillCurrent &&
      (mode !== "interview" || plannedInterviewCanAdvance) &&
      speedCanAdvance
    ) {
      if (mode === "speed") {
        // 上一題超時時曾強制開啟答案；下一題必須回到本輪原本選擇，
        // 否則畫面雖隱藏，telemetry 仍會把它誤算成看過答案。
        setPersisted((previous) => ({
          ...previous,
          settings: {
            ...previous.settings,
            ...speedAnswerPolicy(previous.settings.speedAnswerVisible)
          }
        }));
      }
      moveToNext(
        "completed",
        mode !== "speed" || memoryPolicy.memoryEligible
      );
    }
  }, [
    allTests,
    commitLatestDraft,
    commitLatestNote,
    currentId,
    ensureRecallRound,
    expireSpeedQuestion,
    formatCurrentCode,
    mode,
    moveToNext,
    problem,
    resetProblemTimer,
    run,
    runnerStatus,
    startFreshEditorEntry,
    updateRepeatSession,
    updateSpeedSession
  ]);

  const skip = useCallback(() => {
    // Speed 與 Repeat 都是強迫流程；F10 與按鈕都不能改動 queue。
    if (mode === "speed" || mode === "repeat") return;
    if (!currentId || !beginProblemTransition()) return;
    const edited = editedCurrentProblemRef.current;
    editedCurrentProblemRef.current = false;
    delete attemptContextsRef.current[currentId];
    const existingRecord = persistedRef.current.records[currentId];
    const hasRecordedPractice = Boolean(
      existingRecord &&
        (existingRecord.attempts > 0 ||
          existingRecord.passed > 0 ||
          existingRecord.failed > 0 ||
          existingRecord.fsrs)
    );
    if (edited || hasRecordedPractice) {
      updateRecord(currentId, (record) =>
        recordAfterSkipping(record, new Date(), edited)
      );
    }
    setSessionStats((previous) => ({
      ...previous,
      skipped: previous.skipped + 1
    }));
    resetProblemTimer();
    reviewActionsRef.current = emptyReviewActionTelemetry();
    moveToNext("skipped", false);
  }, [
    beginProblemTransition,
    currentId,
    mode,
    moveToNext,
    resetProblemTimer,
    updateRecord
  ]);

  const goToPreviousProblem = useCallback(() => {
    if (mode === "speed" || mode === "repeat") return;
    if (!beginProblemTransition()) return;

    const restored = restorePreviousPracticeProblem(
      queue,
      backHistory
    );
    if (restored) {
      if (currentId) markCurrentProblemAttempting();
      const occurredAt = new Date();
      setPersisted((previous) => {
        let recallRounds = previous.recallRounds;
        const activeRound = activeRecallRound(
          recallRounds,
          currentId,
          mode
        );
        if (activeRound) {
          recallRounds = deferRound(recallRounds, {
            eventId: createRandomId(),
            roundId: activeRound.id,
            problemId: currentId,
            at: occurredAt
          });
        }
        const plan = previous.training.activePlan;
        const training = plan
          ? trainingProgramWithCompletedPlan(
              previous.training,
              recordTrainingProblemOutcome(plan, {
                mode,
                activeProblemId: currentId,
                outcome: "left",
                occurredAt
              })
            )
          : previous.training;
        return { ...previous, recallRounds, training };
      });
      resumeEditorDraft();
      setBackHistory(restored.history);
      setQueue(restored.queue);
    }
  }, [
    backHistory,
    beginProblemTransition,
    currentId,
    markCurrentProblemAttempting,
    mode,
    queue,
    resumeEditorDraft,
    setPersisted
  ]);

  const goToNextProblem = useCallback(() => {
    if (mode === "speed" || mode === "repeat") return;
    if (!currentId || !beginProblemTransition()) return;
    if (queue.length > 1) {
      markCurrentProblemAttempting();
      moveToNext("left", false);
    }
  }, [
    beginProblemTransition,
    currentId,
    markCurrentProblemAttempting,
    mode,
    moveToNext,
    queue.length,
  ]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (tabRoleRef.current !== "primary") return;

      const restoreSkeletonShortcut =
        event.code === "KeyR" &&
        event.altKey;
      if (restoreSkeletonShortcut) {
        event.preventDefault();
        event.stopPropagation();
        resetCurrentCode();
        return;
      }

      if (
        event.key === "Escape" &&
        (answerControlsOpen ||
          formatControlsOpen ||
          resetControlsOpen ||
          persistedRef.current.settings.sidebarOpen)
      ) {
        event.preventDefault();
        setAnswerControlsOpen(false);
        setFormatControlsOpen(false);
        setResetControlsOpen(false);
        setPersisted((previous) => ({
          ...previous,
          settings: {
            ...previous.settings,
            sidebarOpen: false
          }
        }));
        return;
      }

      const submitShortcut =
        event.key === "F9" ||
        ((event.metaKey || event.ctrlKey) &&
          !event.shiftKey &&
          event.key === "Enter");
      const skipShortcut =
        event.key === "F10" ||
        ((event.metaKey || event.ctrlKey) &&
          event.shiftKey &&
          event.key === "Enter");
      const previousShortcut = event.key === "F8";

      if (previousShortcut) {
        event.preventDefault();
        event.stopPropagation();
        goToPreviousProblem();
      } else if (submitShortcut) {
        event.preventDefault();
        event.stopPropagation();
        void execute();
      } else if (skipShortcut) {
        event.preventDefault();
        event.stopPropagation();
        skip();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [
    answerControlsOpen,
    execute,
    formatControlsOpen,
    goToPreviousProblem,
    resetCurrentCode,
    resetControlsOpen,
    skip
  ]);

  const addCustomTest = () => {
    if (!problem || !customInput.trim() || !customExpected.trim()) return;
    const test: CustomTestCase = {
      id: createRandomId(),
      name: `自訂 ${((persisted.customTests[problem.id] ?? []).length || 0) + 1}`,
      input: customInput.trim(),
      expected: customExpected.trim()
    };
    setPersisted((previous) => ({
      ...previous,
      customTests: {
        ...previous.customTests,
        [problem.id]: [...(previous.customTests[problem.id] ?? []), test]
      }
    }));
    setCustomInput("");
    setCustomExpected("");
  };

  const removeCustomTest = (id: string) => {
    if (!problem) return;
    setPersisted((previous) => ({
      ...previous,
      customTests: {
        ...previous.customTests,
        [problem.id]: (previous.customTests[problem.id] ?? []).filter(
          (item) => item.id !== id
        )
      }
    }));
  };

  const toggleMode = (nextMode: PracticeMode) => {
    if (executionInFlightRef.current || nextMode === mode) return;
    const leavingSpeedRound =
      mode === "speed" &&
      (speedSessionRef.current.phase === "running" ||
        speedSessionRef.current.phase === "timeout");
    const leavingRepeatRound =
      mode === "repeat" && repeatSessionRef.current.phase === "running";
    if (
      (leavingSpeedRound || leavingRepeatRound) &&
      !window.confirm(
        leavingRepeatRound
          ? "Repeat 三輪尚未完成。確定中斷這輪並切換模式？"
          : "Speed 本輪尚未完成。確定中斷這輪並切換模式？"
      )
    ) {
      return;
    }
    const enteringSpeedMode = nextMode === "speed";
    const enteringRepeatMode = nextMode === "repeat";
    const switchPolicy = practiceModeSwitchPolicy(mode, nextMode);
    // 切模式是導覽，不是提交。先保存文字，但不能新增
    // attempt／failure，也不能調整 FSRS。
    commitLatestDraft();
    commitLatestNote();
    const switchedAt = new Date();
    setPersisted((previous) => {
      let recallRounds = previous.recallRounds;
      const activeRound = activeRecallRound(recallRounds, currentId, mode);
      if (activeRound) {
        recallRounds = deferRound(recallRounds, {
          eventId: createRandomId(),
          roundId: activeRound.id,
          problemId: currentId,
          at: switchedAt
        });
      }
      const activePlan = previous.training.activePlan;
      const trainingWithOutcome = activePlan
        ? trainingProgramWithCompletedPlan(
            previous.training,
            recordTrainingProblemOutcome(activePlan, {
              mode,
              activeProblemId: currentId,
              outcome: "abandoned",
              occurredAt: switchedAt
            })
          )
        : previous.training;
      return {
        ...previous,
        recallRounds,
        training: programWithPausedTraining(trainingWithOutcome),
        settings: {
          ...previous.settings,
          mode: nextMode,
          answerOpen: false,
          answerReferenceOpen: false,
          explanationOpen: false
        }
      };
    });
    setAnswerControlsOpen(false);
    setResetControlsOpen(false);
    setBackHistory([]);

    if (switchPolicy.preserveCurrentProblem) {
      const candidates =
        nextMode === "explore"
          ? explorationProblems
          : filteredProblems;
      const source = sessionProblemsForMode(
        nextMode,
        nextMode === "explore" ? shuffled(candidates) : candidates,
        persistedRef.current.records,
        {
          now: switchedAt,
          randomize: nextMode === "free" && randomOrder,
          allowEarly: nextMode === "free",
          recentProblemIds: backHistory
        }
      );
      const currentIsEligible = source.some((item) => item.id === currentId);
      if (currentIsEligible) {
        const sourceIds = source.map((item) => item.id);
        const nextQueue = queueAfterPreservedModeSwitch(
          currentId,
          sourceIds,
          persistedRef.current.settings.sessionSize,
          sourceIds
        );

        // 只改「後面要刷哪些題」。目前題目、草稿、結果、計時、
        // session 統計與 FSRS 紀錄全部保持原樣。
        setQueue(nextQueue);
        setSessionGoal(nextQueue.length);
        return;
      }
      // 例如從 Free 的提前複習切到 Guided：目前未到期題不能偷渡，
      // 下面會依新模式建立乾淨 queue。
    }

    // 獨立回合會換掉 editor，因此清除「正在編輯」旗標；
    // 草稿剛剛已保存，但這次離開不會被標成提取失敗。
    editedCurrentProblemRef.current = false;
    setSubmitted(false);
    setResults([]);
    const now = Date.now();
    setSessionStartedAt(now);
    resetProblemTimer();
    if (enteringSpeedMode || enteringRepeatMode) {
      sessionRevisionRef.current += 1;
      setQueue([]);
      setSessionGoal(0);
      setSessionStats({
        attempted: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        totalMs: 0
      });
      updateSpeedSession(() => emptySpeedSession());
      updateRepeatSession(() => emptyRepeatSession());
      setSpeedFeedback(null);
      setRepeatFeedback(null);
      if (enteringRepeatMode) {
        startSession(false, "repeat", false);
      }
      return;
    }
    updateSpeedSession(() => emptySpeedSession());
    updateRepeatSession(() => emptyRepeatSession());
    setSpeedFeedback(null);
    setRepeatFeedback(null);
    startSession(
      nextMode === "explore"
        ? true
        : nextMode === "guided"
          ? false
          : randomOrder,
      nextMode,
      false
    );
  };

  const trainingToday = trainingDateKey(clockNow);
  const activeTrainingPlan = trainingPlanForDate(
    persisted.training,
    trainingToday
  );
  const todayTrainingCompleted = Boolean(
    persisted.training.completedDays[trainingToday]
  );
  const resumableTrainingPlan = activeTrainingPlan;
  const trainingPreview = useMemo(() => {
    if (
      !indexData ||
      resumableTrainingPlan ||
      todayTrainingCompleted ||
      nextTrainingDay(persisted.training, new Date(clockNow)) > 30
    ) {
      return null;
    }
    return buildDailyTrainingPlan({
      problems: indexData.problems,
      records: persisted.records,
      program: persisted.training,
      preset: persisted.training.preset,
      now: new Date()
    });
  }, [
    indexData,
    persisted.records,
    persisted.training,
    resumableTrainingPlan,
    trainingToday,
    todayTrainingCompleted
  ]);
  const displayedTrainingPlan =
    resumableTrainingPlan ?? trainingPreview;
  const displayedPlanIsPreview =
    Boolean(trainingPreview) &&
    displayedTrainingPlan?.id === trainingPreview?.id;

  const launchTrainingBlock = useCallback(
    (sourcePlan: DailyTrainingPlan) => {
      if (executionInFlightRef.current) return;
      const startedPlan = startTrainingBlock(sourcePlan);
      const block = currentTrainingBlock(startedPlan);
      if (!block) return;
      const selectedIds = normalizePracticeQueue(
        block.remainingProblemIds.length > 0
          ? block.remainingProblemIds
          : block.problemIds,
        indexData?.problems.map((item) => item.id) ?? []
      );
      if (!selectedIds.length) return;

      markCurrentProblemAttempting();
      commitLatestDraft();
      commitLatestNote();
      attemptContextsRef.current = {};
      editedCurrentProblemRef.current = false;
      reviewActionsRef.current = emptyReviewActionTelemetry();
      sessionRevisionRef.current += 1;
      startFreshEditorEntry();
      setBackHistory([]);
      setQueue(selectedIds);
      setSessionGoal(selectedIds.length);
      setResults([]);
      setSubmitted(false);
      setSessionStats({
        attempted: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        totalMs: 0
      });
      const startedAt = Date.now();
      setSessionStartedAt(startedAt);
      resetProblemTimer();
      setAnswerControlsOpen(false);
      setResetControlsOpen(false);
      setSpeedFeedback(null);
      setRepeatFeedback(null);

      const plannedInterviewMinutes = {
        light: 30,
        standard: 45,
        intensive: 60
      }[startedPlan.preset];
      if (block.mode === "interview") {
        setInterviewMinutes(plannedInterviewMinutes);
      }

      const questionLimitMs = speedQuestionLimitMs(
        persistedRef.current.settings.speedQuestionSeconds
      );
      if (block.mode === "speed") {
        updateSpeedSession(() => ({
          ...emptySpeedSession(questionLimitMs),
          phase: "running",
          total: selectedIds.length
        }));
      } else {
        updateSpeedSession(() => emptySpeedSession(questionLimitMs));
      }
      updateRepeatSession(() => emptyRepeatSession());

      setPersisted((previous) => ({
        ...previous,
        training: {
          ...previous.training,
          startedOn: previous.training.startedOn ?? startedPlan.date,
          activePlan: startedPlan
        },
        settings: {
          ...previous.settings,
          mode: block.mode,
          answerOpen: false,
          answerReferenceOpen: false,
          explanationOpen: false,
          speedAnswerVisible:
            block.mode === "speed"
              ? false
              : previous.settings.speedAnswerVisible,
          interviewMinutes:
            block.mode === "interview"
              ? plannedInterviewMinutes
              : previous.settings.interviewMinutes
        }
      }));
      setTrainingMenuOpen(false);
    },
    [
      commitLatestDraft,
      commitLatestNote,
      indexData,
      markCurrentProblemAttempting,
      resetProblemTimer,
      startFreshEditorEntry,
      updateRepeatSession,
      updateSpeedSession
    ]
  );

  const handleTrainingPrimaryAction = useCallback(() => {
    const existing = trainingPlanForDate(
      persistedRef.current.training,
      trainingDateKey()
    );
    if (existing?.status === "running") {
      if (queue.length > 0) {
        setTrainingMenuOpen(false);
      } else {
        launchTrainingBlock(existing);
      }
      return;
    }
    if (
      existing?.status === "completed" &&
      existing.date === trainingDateKey()
    ) {
      return;
    }
    const plan =
      existing && existing.status !== "completed"
        ? existing
        : buildDailyTrainingPlan({
            problems: indexData?.problems ?? [],
            records: persistedRef.current.records,
            program: persistedRef.current.training,
            preset: persistedRef.current.training.preset,
            now: new Date()
          });
    if (!plan) return;
    launchTrainingBlock(plan);
  }, [indexData, launchTrainingBlock, queue.length]);

  const handleTrainingPresetChange = useCallback(
    (preset: TrainingMenuSize) => {
      setPersisted((previous) => ({
        ...previous,
        training: { ...previous.training, preset }
      }));
    },
    []
  );

  const handleTrainingPause = useCallback(() => {
    markCurrentProblemAttempting();
    const pausedAt = new Date();
    setPersisted((previous) => {
      const plan = previous.training.activePlan;
      if (!plan) return previous;
      const synced = syncTrainingPlanQueue(
        plan,
        queue,
        previous.settings.mode
      );
      const outcomePlan = recordTrainingProblemOutcome(synced, {
        mode,
        activeProblemId: currentId,
        outcome: "abandoned",
        occurredAt: pausedAt
      });
      let recallRounds = previous.recallRounds;
      const activeRound = activeRecallRound(
        recallRounds,
        currentId,
        mode
      );
      if (activeRound) {
        recallRounds = deferRound(recallRounds, {
          eventId: createRandomId(),
          roundId: activeRound.id,
          problemId: currentId,
          at: pausedAt
        });
      }
      return {
        ...previous,
        recallRounds,
        training: {
          ...previous.training,
          activePlan: pauseTrainingPlan(outcomePlan)
        }
      };
    });
    sessionRevisionRef.current += 1;
    setQueue([]);
    setBackHistory([]);
    setResults([]);
    setSubmitted(false);
    setSessionGoal(0);
    resetProblemTimer();
    updateSpeedSession(() => emptySpeedSession());
    updateRepeatSession(() => emptyRepeatSession());
  }, [
    currentId,
    markCurrentProblemAttempting,
    mode,
    queue,
    resetProblemTimer,
    updateRepeatSession,
    updateSpeedSession
  ]);

  const handleTrainingRebuild = useCallback(() => {
    const current = trainingPlanForDate(
      persistedRef.current.training,
      trainingDateKey()
    );
    if (
      current?.blocks.some((block) => block.status === "completed") &&
      !window.confirm("重新產生會捨棄今天已完成的區塊進度。確定繼續？")
    ) {
      return;
    }
    const plan = buildDailyTrainingPlan({
      problems: indexData?.problems ?? [],
      records: persistedRef.current.records,
      program: persistedRef.current.training,
      preset: persistedRef.current.training.preset,
      now: new Date()
    });
    if (!plan) return;
    setPersisted((previous) => ({
      ...previous,
      training: {
        ...previous.training,
        startedOn: previous.training.startedOn ?? plan.date,
        activePlan: plan
      }
    }));
  }, [indexData]);

  useEffect(() => {
    if (!hydrated || tabRole !== "primary") return;
    setPersisted((previous) => {
      const plan = previous.training.activePlan;
      if (!plan) return previous;
      const nextPlan = syncTrainingPlanQueue(
        plan,
        queue,
        mode,
        new Date()
      );
      if (nextPlan === plan) return previous;
      return {
        ...previous,
        training: trainingProgramWithCompletedPlan(
          previous.training,
          nextPlan
        )
      };
    });
  }, [hydrated, mode, queue, setPersisted, tabRole]);

  useEffect(() => {
    if (!hydrated || tabRole !== "primary" || queue.length > 0) return;
    const plan = persistedRef.current.training.activePlan;
    const block = currentTrainingBlock(plan);
    if (
      plan?.status !== "running" ||
      !block ||
      block.mode !== mode ||
      block.remainingProblemIds.length === 0
    ) {
      return;
    }
    // 本輪 queue 已消耗完但仍有跳過／未達標題目：停在可恢復狀態，
    // 不把空 queue 誤判成區塊完成，也不在背景無限回收同一題。
    setPersisted((previous) => ({
      ...previous,
      training: {
        ...previous.training,
        activePlan: pauseTrainingPlan(previous.training.activePlan)
      }
    }));
    setTrainingMenuOpen(true);
  }, [hydrated, mode, queue.length, setPersisted, tabRole]);

  useEffect(() => {
    const status = persisted.training.activePlan?.status;
    const previousStatus = previousTrainingStatusRef.current;
    previousTrainingStatusRef.current = status;
    if (
      previousStatus === "running" &&
      (status === "ready" || status === "completed")
    ) {
      setTrainingMenuOpen(true);
    }
  }, [persisted.training.activePlan?.status]);

  const sessionElapsed = (clockNow - sessionStartedAt) / 1000;
  const problemTimerPaused =
    problemTimer.started && problemTimer.runningSince === undefined;
  const speedQuestionActive =
    mode === "speed" &&
    (speedSession.phase === "running" || speedSession.phase === "timeout") &&
    speedSession.questionId === currentId;
  const configuredSpeedLimitMs = speedQuestionLimitMs(
    persisted.settings.speedQuestionSeconds
  );
  const speedLimitMs =
    speedSession.phase === "setup"
      ? configuredSpeedLimitMs
      : speedSession.questionLimitMs;
  const speedLimitSeconds = Math.round(speedLimitMs / 1000);
  const speedTimedOut = mode === "speed" && speedSession.phase === "timeout";
  const speedSolutionVisible =
    mode === "speed" &&
    speedSession.phase === "running" &&
    persisted.settings.speedAnswerVisible;
  const repeatActive =
    mode === "repeat" && repeatSession.phase === "running";
  const forcedPracticeActive =
    repeatActive ||
    (mode === "speed" &&
      (speedSession.phase === "running" ||
        speedSession.phase === "timeout"));

  // 傳給子元件（ProblemLibrary / SpeedModeScreen / TrainingDashboard /
  // ErrorOverview）的 callback 用 useCallback 固定 identity，讓子元件
  // 可以 memo。常變動的判斷值（runnerBusy 等）走 ref，不進依賴列表。
  const librarySelectGuardsRef = useRef({
    runnerBusy: false,
    forcedPracticeActive: false,
    currentId: ""
  });
  librarySelectGuardsRef.current = {
    runnerBusy,
    forcedPracticeActive,
    currentId
  };
  const handleLibraryFiltersChange = useCallback(
    (updates: Partial<Filters>) => {
      setFilters((previous) => ({ ...previous, ...updates }));
    },
    []
  );
  const handleLibraryClearFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS);
  }, []);
  const handleLibraryToggle = useCallback(() => {
    setPersisted((previous) => ({
      ...previous,
      settings: {
        ...previous.settings,
        libraryOpen: !previous.settings.libraryOpen,
        ...(!previous.settings.libraryOpen
          ? {
              filterOpen: false,
              statsOpen: false,
              errorsOpen: false
            }
          : {})
      }
    }));
  }, [setPersisted]);
  const handleLibrarySelect = useCallback(
    (id: string) => {
      const {
        runnerBusy: busy,
        forcedPracticeActive: locked,
        currentId: activeId
      } = librarySelectGuardsRef.current;
      if (busy || locked || !beginProblemTransition()) return;
      if (id !== activeId) {
        markCurrentProblemAttempting();
        startFreshEditorEntry();
        if (activeId) {
          setBackHistory((history) =>
            rememberPracticeProblem(history, activeId)
          );
        }
        setQueue((previous) => [
          id,
          ...previous.slice(1).filter((item) => item !== id)
        ]);
      }
      setPersisted((previous) => ({
        ...previous,
        settings: {
          ...previous.settings,
          sidebarOpen: false
        }
      }));
    },
    [
      beginProblemTransition,
      markCurrentProblemAttempting,
      setPersisted,
      startFreshEditorEntry
    ]
  );
  const handleStatsToggle = useCallback(() => {
    setPersisted((previous) => ({
      ...previous,
      settings: {
        ...previous.settings,
        statsOpen: !previous.settings.statsOpen,
        ...(!previous.settings.statsOpen
          ? {
              filterOpen: false,
              errorsOpen: false,
              libraryOpen: false
            }
          : {})
      }
    }));
  }, [setPersisted]);
  const handleErrorsToggle = useCallback(() => {
    setPersisted((previous) => ({
      ...previous,
      settings: {
        ...previous.settings,
        errorsOpen: !previous.settings.errorsOpen,
        ...(!previous.settings.errorsOpen
          ? {
              filterOpen: false,
              statsOpen: false,
              libraryOpen: false
            }
          : {})
      }
    }));
  }, [setPersisted]);
  const handleSpeedCategoryChange = useCallback((category: string) => {
    setFilters((previous) => ({ ...previous, category }));
  }, []);
  const handleSpeedSourceChange = useCallback((source: string) => {
    setFilters((previous) => ({ ...previous, source }));
  }, []);
  const handleSpeedDifficultyChange = useCallback(
    (difficulty: DifficultyFilter) => {
      setFilters((previous) => ({ ...previous, difficulty }));
    },
    []
  );
  const handleSpeedStatusChange = useCallback(
    (status: Filters["status"]) => {
      setFilters((previous) => ({ ...previous, status }));
    },
    []
  );
  const handleSessionSizeChange = useCallback(
    (sessionSize: number) => {
      setPersisted((previous) => ({
        ...previous,
        settings: { ...previous.settings, sessionSize }
      }));
    },
    [setPersisted]
  );
  const handleSpeedAnswerVisibleChange = useCallback(
    (speedAnswerVisible: boolean) => {
      setPersisted((previous) => ({
        ...previous,
        settings: { ...previous.settings, speedAnswerVisible }
      }));
    },
    [setPersisted]
  );
  const handleSpeedQuestionSecondsChange = useCallback(
    (speedQuestionSeconds: number) => {
      setPersisted((previous) => ({
        ...previous,
        settings: {
          ...previous.settings,
          speedQuestionSeconds
        }
      }));
    },
    [setPersisted]
  );
  const handleSpeedNewSetup = useCallback(() => {
    updateSpeedSession(() => emptySpeedSession());
    setQueue([]);
    setSessionGoal(0);
    setSpeedFeedback(null);
  }, [updateSpeedSession]);

  const repeatStagePercent = repeatRevealPercent(repeatSession.stage);
  const record = currentId ? recordFor(persisted, currentId) : defaultRecord();
  const currentReviewTime = new Date(clockNow);
  const currentMemoryPercent = Math.round(
    retrievability(record.fsrs, currentReviewTime) * 100
  );
  const currentFamiliarity = familiarityLabel(
    record.fsrs,
    currentReviewTime
  );
  const currentGuidedReason = guidedSelectionReason(
    record,
    currentReviewTime
  );
  const currentSubmissionHistory = useMemo(
    () =>
      persisted.submissionHistory.filter(
        (submission) => submission.problemId === currentId
      ),
    [currentId, persisted.submissionHistory]
  );
  const recentFailedSubmissions = useMemo(() => {
    return recentMemoryFailureCount(
      persisted.submissionHistory,
      currentId,
      record.fsrs?.last_review
    );
  }, [currentId, persisted.submissionHistory, record.fsrs?.last_review]);
  const successfulMemorySubmissions = useMemo(
    () =>
      memoryEligiblePassCount(
        persisted.submissionHistory,
        currentId
      ),
    [currentId, persisted.submissionHistory]
  );
  const latestSubmissionElapsed =
    (currentSubmissionHistory[0]?.durationMs ?? 0) / 1000;
  const canReveal =
    (mode !== "interview" &&
      !(mode === "speed" && speedSession.phase === "running" && !speedSolutionVisible)) ||
    submitted ||
    speedTimedOut;
  const effectiveAnswerRevealPercent = repeatActive
    ? repeatStagePercent
    : speedTimedOut || speedSolutionVisible
    ? 100
    : persisted.settings.adaptiveAnswerFade
    ? adaptiveAnswerPercent({
        successfulSubmissions: successfulMemorySubmissions,
        recentFailedSubmissions,
        status: record.status,
        retrievability: currentMemoryPercent / 100
      })
    : persisted.settings.answerRevealMode === "full"
      ? 100
      : persisted.settings.answerRevealPercent;
  const effectiveAnswerRevealMode = repeatActive
    ? repeatStagePercent === 100
      ? "full"
      : "random"
    : speedTimedOut || speedSolutionVisible
    ? "full"
    : persisted.settings.adaptiveAnswerFade
    ? effectiveAnswerRevealPercent === 100
      ? "full"
      : "random"
    : persisted.settings.answerRevealMode;
  const revealedAnswer = useMemo(() => {
    if (!problem) return "";
    return buildRevealedAnswer(
      problem.overlayAnswer || problem.answer,
      effectiveAnswerRevealMode,
      effectiveAnswerRevealPercent,
      problem.id,
      answerRevealSeed
    );
  }, [
    answerRevealSeed,
    effectiveAnswerRevealMode,
    effectiveAnswerRevealPercent,
    problem
  ]);
  const answerDisplay = answerDisplayPolicy({
    canReveal,
    answerOpen: persisted.settings.answerOpen,
    comparisonOpen: answerComparisonOpen,
    forceOverlay: repeatActive,
    hasAnswer: Boolean(revealedAnswer)
  });
  const answerOverlayActive = answerDisplay.overlayVisible;
  const answerComparisonActive = answerDisplay.comparisonVisible;
  const allPassed = results.length > 0 && results.every((item) => item.passed);
  const latestFailedResult = firstFailedResult(results);
  const latestFailureReason = failureReason(latestFailedResult);
  const latestErrorLine = sourceLineFromTestResult(latestFailedResult);
  useEffect(() => {
    if (!latestErrorLine) return;

    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      // 先讓錯誤摘要完成排版，再把真正錯誤行捲到 editor 中央。
      secondFrame = requestAnimationFrame(() => {
        codeEditorRef.current?.focusErrorLine(latestErrorLine);
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [latestErrorLine, results]);
  // due 判定最細只到分鐘級；用分鐘刻度當依賴，clockNow 的更新
  // 不會讓 481 題的物件 spread + FSRS 計算每次 render 重跑。
  const clockMinuteMs = Math.floor(clockNow / 60_000) * 60_000;
  const todayProgress = useMemo(
    () =>
      summarizeDailyProgress(
        persisted.recallRounds,
        persisted.submissionHistory,
        new Date(clockNow)
      ),
    [clockNow, persisted.recallRounds, persisted.submissionHistory]
  );
  const dueCount = useMemo(() => {
    const reviewTime = new Date(clockMinuteMs);
    return (indexData?.problems ?? []).reduce(
      (total, item) =>
        total +
        Number(
          isRecordReadyForReview(
            // recordFor 只讀 records；依賴列表用 persisted.records 即可。
            recordFor(persisted, item.id),
            reviewTime
          )
        ),
      0
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockMinuteMs, indexData, persisted.records]);

  if (!indexData && indexLoadError) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">
          <AlertTriangle size={22} />
        </div>
        <p>{indexLoadError}</p>
        <button
          className="primary"
          style={{ marginTop: 12 }}
          onClick={() => {
            setIndexLoadError(null);
            setIndexLoadAttempt((value) => value + 1);
          }}
        >
          重試
        </button>
      </main>
    );
  }

  if (!hydrated || !indexData) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">&lt;&gt;</div>
        <p>正在整理題庫與上次練習狀態…</p>
      </main>
    );
  }

  return (
    <>
      {tabRole === "secondary" && (
        <div className="multi-tab-readonly-banner" role="status">
          <LockKeyhole size={16} />
          <strong>此分頁目前唯讀</strong>
          <span>
            另一個 RECODE 分頁正在寫入；這裡會同步最新進度，主分頁切離或關閉後會自動接手。
          </span>
        </div>
      )}
      <main
        className={`app-shell ${
          tabRole === "secondary" ? "secondary-tab" : ""
        }`}
        inert={tabRole === "secondary" ? true : undefined}
      >
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Braces size={18} />
          </div>
          <div>
            <strong>RECODE</strong>
            <span>演算法重建訓練場</span>
          </div>
        </div>

        <div className="top-daily-actions">
        <button
          className={`daily-training-trigger ${
            activeTrainingPlan?.status === "running" ? "active" : ""
          }`}
          onClick={() => setTrainingMenuOpen(true)}
          disabled={runnerBusy}
          title="依 30 日課表、FSRS 到期與目前弱點，自動安排今天的練習順序"
        >
          <CalendarDays size={15} />
          <strong>今日特訓</strong>
          <span>
            {nextTrainingDay(persisted.training) > 30
              ? "完成"
              : `Day ${
                  displayedTrainingPlan?.planDay ??
                  nextTrainingDay(persisted.training)
                }`}
          </span>
        </button>

        <button
          className="daily-progress-trigger"
          onClick={() =>
            setPersisted((previous) => ({
              ...previous,
              settings: {
                ...previous.settings,
                sidebarOpen: true,
                statsOpen: true
              }
            }))
          }
          title="查看今天唯一作答題數、獨立 AC、輔助完成與未完成題"
        >
          <strong>今日 {todayProgress.touchedProblemIds.size} 題</strong>
          <span>
            {todayProgress.independentCompletedProblemIds.size} 獨立 AC
          </span>
        </button>
        </div>

        <div className="mode-switch" aria-label="練習模式">
          <button
            className={mode === "guided" ? "active" : ""}
            onClick={() => toggleMode("guided")}
            disabled={runnerBusy}
            title="只安排 FSRS 已到期與新題；預設隱藏答案，替你決定下一題"
          >
            <BookOpen size={15} /> 引導
          </button>
          <button
            className={mode === "free" ? "active" : ""}
            onClick={() => toggleMode("free")}
            disabled={runnerBusy}
            title="保留完整題組與手動切題控制，由你自由決定怎麼練"
          >
            <SlidersHorizontal size={15} /> 自由
          </button>
          <button
            className={mode === "explore" ? "active explore" : ""}
            onClick={() => toggleMode("explore")}
            disabled={runnerBusy}
            title="只從曾經 AC 的題目中隨機抽題"
          >
            <Compass size={15} /> 探險
          </button>
          <button
            className={mode === "speed" ? "active speed" : ""}
            onClick={() => toggleMode("speed")}
            disabled={runnerBusy}
            title={`每題 ${speedLimitSeconds} 秒；超時後必須看答案重打`}
          >
            <Zap size={15} /> Speed
          </button>
          <button
            className={mode === "repeat" ? "active repeat" : ""}
            onClick={() => toggleMode("repeat")}
            disabled={runnerBusy}
            title="同一題強制從 100% → 75% → 50% 逐輪重建"
          >
            <RotateCcw size={15} /> Repeat
          </button>
          <button
            className={mode === "interview" ? "active danger" : ""}
            onClick={() => toggleMode("interview")}
            disabled={runnerBusy}
          >
            <Flame size={15} /> 模擬面試
          </button>
        </div>

        <div className={`top-metrics ${mode === "speed" ? "speed-active" : mode === "repeat" ? "repeat-active" : ""}`}>
          {mode === "speed" ? (
            <SpeedHud
              phase={speedSession.phase}
              score={speedSession.score}
              questionActive={speedQuestionActive}
              timedOut={speedTimedOut}
              deadlineAt={speedSession.deadlineAt}
              limitMs={speedLimitMs}
              queueCount={queue.length}
            />
          ) : mode === "repeat" ? (
            <div className="repeat-hud">
              <span className="repeat-hud-stage">
                <RotateCcw size={15} /> 第 {repeatSession.stage + 1}/3 輪
              </span>
              <span className="repeat-hud-answer">
                答案 {repeatStagePercent}%
              </span>
              <span className="repeat-hud-progress">
                完成 {repeatSession.completed}/{repeatSession.total || sessionGoal}
              </span>
              <span className="queue-pill">{queue.length} 題</span>
            </div>
          ) : (
            <>
              <AttemptTimerDisplay timer={problemTimer} />
              <button
                className="icon-text-button"
                onClick={resetProblemTimer}
                disabled={runnerBusy}
                title="手動把本題計時歸零；下次輸入時重新開始"
              >
                <TimerReset size={15} />
                重置
              </button>
              {mode === "interview" ? (
                <InterviewCountdown
                  startedAt={sessionStartedAt}
                  minutes={interviewMinutes}
                />
              ) : (
                <button
                  className="icon-text-button"
                  disabled={!problemTimer.started || runnerBusy}
                  onClick={() => {
                    const now = Date.now();
                    updateProblemTimer((current) =>
                      current.runningSince === undefined
                        ? beginOrResumeAttempt(current, now)
                        : pauseAttempt(current, now)
                    );
                    setClockNow(now);
                  }}
                >
                  {problemTimerPaused ? (
                    <Play size={15} />
                  ) : (
                    <Pause size={15} />
                  )}
                  {problemTimerPaused ? "繼續" : "暫停"}
                </button>
              )}
              <span className="queue-pill">{queue.length} 題待處理</span>
            </>
          )}
        </div>
      </header>

      <DailyTrainingMenu
        open={trainingMenuOpen}
        program={persisted.training}
        displayPlan={displayedTrainingPlan}
        isPreview={displayedPlanIsPreview}
        todayCompleted={todayTrainingCompleted}
        disabled={runnerBusy}
        onClose={() => setTrainingMenuOpen(false)}
        onPresetChange={handleTrainingPresetChange}
        onPrimaryAction={handleTrainingPrimaryAction}
        onPause={handleTrainingPause}
        onRebuild={handleTrainingRebuild}
      />

      <section className="controlbar">
        <div className="control-group">
          {activeTrainingPlan?.status === "running" &&
            currentTrainingBlock(activeTrainingPlan) && (
              <button
                className="control active training-plan-indicator"
                onClick={() => setTrainingMenuOpen(true)}
                title="開啟今日特訓進度"
              >
                <CalendarDays size={15} />
                Day {activeTrainingPlan.planDay} ·{" "}
                {currentTrainingBlock(activeTrainingPlan)?.title}
              </button>
            )}
          {mode !== "speed" && (
            <label className="compact-select">
              本輪
              <select
                value={persisted.settings.sessionSize}
                disabled={runnerBusy}
                onChange={(event) =>
                  setPersisted((previous) => ({
                    ...previous,
                    settings: {
                      ...previous.settings,
                      sessionSize: Number(event.target.value)
                    }
                  }))
                }
              >
                <option value={10}>10 題</option>
                <option value={20}>20 題</option>
                <option value={30}>30 題</option>
                <option value={0}>全部</option>
              </select>
            </label>
          )}
          {mode === "interview" && (
            <label className="compact-select">
              時限
              <select
                value={interviewMinutes}
                disabled={runnerBusy}
                onChange={(event) => {
                  const interviewMinutes = Number(event.target.value);
                  setInterviewMinutes(interviewMinutes);
                  setPersisted((previous) => ({
                    ...previous,
                    settings: {
                      ...previous.settings,
                      interviewMinutes
                    }
                  }));
                }}
              >
                <option value={30}>30 分</option>
                <option value={45}>45 分</option>
                <option value={60}>60 分</option>
              </select>
            </label>
          )}
          {mode === "speed" ? (
            <span
              className="control active speed-control-indicator"
              title={`Speed 題組由 FSRS 排序。目前題目：${currentGuidedReason}`}
            >
              <Zap size={15} /> {speedLimitSeconds} 秒 · FSRS 選題
            </span>
          ) : mode === "repeat" ? (
            <span
              className="control active repeat-control-indicator"
              title="同一題通過 100%、75%、50% 三輪後，30 分鐘後再由無提示模式驗收；引導三輪不會冒充記憶。"
            >
              <RotateCcw size={15} /> 引導重建 · 100% → 75% → 50% · 30 分後 0%
            </span>
          ) : mode === "explore" ? (
            <span
              className="control active exploration-pool-indicator"
              title="只計算目前所有篩選條件下曾經 AC 的題目"
            >
              <Compass size={15} />
              已解題 {explorationProblems.length} 題
            </span>
          ) : mode === "guided" ? (
            <span
              className="control active guided-control-indicator"
              title="引導模式只放入目前已到期或尚未建立排程的題目；尚未到期題不會混進來。"
            >
              <BookOpen size={15} />
              {currentGuidedReason}
            </span>
          ) : (
            <button
              className={`control ${randomOrder ? "active" : ""}`}
              disabled={runnerBusy}
              onClick={() => {
                const nextRandomOrder = !randomOrder;
                setRandomOrder(nextRandomOrder);
                setPersisted((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    randomOrder: nextRandomOrder
                  }
                }));
              }}
              title="FSRS-7 先選出已到期題與新題；隨機只打亂同一優先層，不會放入尚未到期題"
            >
              <Shuffle size={15} /> 隨機
            </button>
          )}
          {mode !== "speed" && mode !== "repeat" && (
            <button
              className="primary small"
              disabled={runnerBusy}
              onClick={() => startSession()}
            >
              {mode === "explore" ? (
                <>
                  <Shuffle size={14} /> 重新探險
                </>
              ) : mode === "guided" ? (
                <>
                  <Play size={14} /> 重新引導
                </>
              ) : (
                <>
                  <Play size={14} /> 開始這組
                </>
              )}
            </button>
          )}
        </div>

        <div className="control-group right">
          <button
            className="control"
            onClick={() =>
              setPersisted((previous) => ({
                ...previous,
                settings: {
                  ...previous.settings,
                  language:
                    previous.settings.language === "zh" ? "en" : "zh"
                }
              }))
            }
          >
            <Languages size={15} />
            {persisted.settings.language === "zh" ? "繁中" : "English"}
          </button>
        </div>
      </section>

      {mode === "speed" &&
      (speedSession.phase === "setup" || speedSession.phase === "finished") ? (
        <SpeedModeScreen
          phase={speedSession.phase}
          candidateCount={speedReadyProblems.length}
          category={filters.category}
          source={filters.source}
          difficulty={filters.difficulty}
          status={filters.status}
          categories={indexData.categories}
          sources={indexData.sources}
          sessionSize={persisted.settings.sessionSize}
          speedAnswerVisible={persisted.settings.speedAnswerVisible}
          speedQuestionSeconds={persisted.settings.speedQuestionSeconds}
          speed={speedSession}
          acceptedTotal={sessionStats.passed}
          onCategoryChange={handleSpeedCategoryChange}
          onSourceChange={handleSpeedSourceChange}
          onDifficultyChange={handleSpeedDifficultyChange}
          onStatusChange={handleSpeedStatusChange}
          onSessionSizeChange={handleSessionSizeChange}
          onSpeedAnswerVisibleChange={handleSpeedAnswerVisibleChange}
          onSpeedQuestionSecondsChange={handleSpeedQuestionSecondsChange}
          onStart={startSpeedChallenge}
          onNewSetup={handleSpeedNewSetup}
        />
      ) : !currentId ? (
        <section className="empty-session">
          {mode === "explore" ? <Compass size={34} /> : <Check size={34} />}
          <h1>
            {mode === "explore"
              ? explorationProblems.length
                ? "這輪探險已經完成"
                : "目前沒有可探險的題目"
              : "這輪題目已經清空"}
          </h1>
          <p>
            {mode === "explore"
              ? explorationProblems.length
                ? "重新洗牌後，可以再跑一輪已經解過的題目。"
                : "先 AC 一題，或調整題型、題單與難度篩選。"
              : "調整篩選後按「開始這組」，或繼續做今天到期的題目。"}
          </p>
          <button
            className="primary"
            disabled={runnerBusy}
            onClick={() => startSession()}
          >
            {mode === "explore" ? "重新探險" : "建立下一輪"}
          </button>
        </section>
      ) : !problem || problem.id !== currentId ? (
        problemLoadError ? (
          <section className="empty-session">
            <AlertTriangle size={34} />
            <h1>題目載入失敗</h1>
            <p>{problemLoadError}</p>
            <div style={{ display: "flex", gap: 9 }}>
              <button
                className="primary"
                onClick={() => {
                  setProblemLoadError(null);
                  setProblemLoadAttempt((value) => value + 1);
                }}
              >
                重試
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setProblemLoadError(null);
                  moveToNext("left", false);
                }}
              >
                跳過此題
              </button>
            </div>
          </section>
        ) : (
          <section className="empty-session problem-loading">
            <LoaderCircle size={34} />
            <h1>正在載入下一題</h1>
            <p>題目、函式骨架與測資載入完成後才會開放輸入。</p>
          </section>
        )
      ) : (
        <section
          ref={workspaceRef}
          className={`workspace ${
            answerComparisonActive ? "answer-comparison-active" : ""
          } ${dragging ? "is-dragging" : ""}`}
          style={
            {
              "--left-panel": `${persisted.settings.leftPercent}%`
            } as React.CSSProperties
          }
        >
          <aside
            ref={sidebarRef}
            className={`study-sidebar ${
              persisted.settings.sidebarOpen ? "open" : ""
            }`}
            aria-hidden={!persisted.settings.sidebarOpen}
          >
            <header className="study-sidebar-header">
              <span>
                <Menu size={17} />
                <strong>練習工具</strong>
              </span>
              <div className="sidebar-header-actions">
                <span
                  className={`database-status ${databaseStatus}`}
                  title={databaseMessage}
                  aria-label={databaseMessage}
                  role="status"
                >
                  <Database size={14} />
                </span>
                <button
                  className="icon-button"
                  onClick={() => void downloadDatabaseBackup()}
                  title="下載自動命名的 SQLite 備份"
                >
                  <Download size={15} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => restoreInputRef.current?.click()}
                  title="載入 SQLite 備份"
                >
                  <Upload size={15} />
                </button>
                <input
                  ref={restoreInputRef}
                  className="hidden-file-input"
                  type="file"
                  accept=".sqlite,.sqlite3,application/vnd.sqlite3"
                  onChange={(event) => void restoreDatabaseBackup(event)}
                />
                <button
                  className="icon-button"
                  onClick={() =>
                    setPersisted((previous) => ({
                      ...previous,
                      settings: {
                        ...previous.settings,
                        sidebarOpen: false
                      }
                    }))
                  }
                  title="收合側欄"
                >
                  <X size={16} />
                </button>
              </div>
            </header>

            <div className="study-sidebar-scroll">
              <section
                className={`sidebar-filter-drawer ${
                  persisted.settings.filterOpen ? "open" : ""
                }`}
              >
                <button
                  className="sidebar-section-trigger"
                  onClick={() =>
                    setPersisted((previous) => ({
                      ...previous,
                      settings: {
                        ...previous.settings,
                        filterOpen: !previous.settings.filterOpen,
                        ...(!previous.settings.filterOpen
                          ? {
                              statsOpen: false,
                              errorsOpen: false,
                              libraryOpen: false
                            }
                          : {})
                      }
                    }))
                  }
                >
                  <span>
                    <Filter size={16} />
                    <strong>篩選題組</strong>
                    <em>
                      {mode === "explore"
                        ? explorationProblems.length
                        : mode === "repeat"
                          ? repeatEligibleProblems.length
                        : filteredProblems.length}
                      /{indexData.total} 題
                    </em>
                  </span>
                  <ChevronDown
                    size={17}
                    className={
                      persisted.settings.filterOpen ? "rotated" : ""
                    }
                  />
                </button>

                {persisted.settings.filterOpen && (
                  <div className="sidebar-filter-content">
                    <label className="search-field">
                      <Search size={16} />
                      <input
                        value={filters.query}
                        onChange={(event) =>
                          setFilters((previous) => ({
                            ...previous,
                            query: event.target.value
                          }))
                        }
                        placeholder="搜尋題號、名稱或分類"
                      />
                    </label>
                    <select
                      value={filters.category}
                      onChange={(event) =>
                        setFilters((previous) => ({
                          ...previous,
                          category: event.target.value
                        }))
                      }
                    >
                      <option value="all">全部題型</option>
                      {indexData.categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                    <select
                      value={filters.source}
                      onChange={(event) =>
                        setFilters((previous) => ({
                          ...previous,
                          source: event.target.value
                        }))
                      }
                    >
                      <option value="all">全部題單</option>
                      {indexData.sources.map((source) => (
                        <option key={source} value={source}>
                          {source}
                        </option>
                      ))}
                    </select>
                    <select
                      value={filters.difficulty}
                      onChange={(event) =>
                        setFilters((previous) => ({
                          ...previous,
                          difficulty: event.target
                            .value as Filters["difficulty"]
                        }))
                      }
                    >
                      <option value="all">全部難度</option>
                      <option value="easy">只有簡單</option>
                      <option value="medium">只有中等</option>
                      <option value="hard">只有困難</option>
                      <option value="easy-medium">簡單＋中等</option>
                      <option value="medium-hard">中等＋困難</option>
                      <option value="known">全部已標示</option>
                      <option value="unknown">只有未標示</option>
                    </select>
                    <select
                      value={filters.status}
                      onChange={(event) =>
                        setFilters((previous) => ({
                          ...previous,
                          status: event.target.value as Filters["status"]
                        }))
                      }
                    >
                      <option value="all">全部狀態</option>
                      <option value="due">今天到期</option>
                      <option value="solved">已解決（曾 AC）</option>
                      <option value="new">未開始</option>
                      <option value="learning">嘗試中</option>
                      <option value="retry">需要重刷</option>
                      <option value="completed">已完成</option>
                      <option value="mastered">已掌握</option>
                      <option value="starred">已收藏</option>
                    </select>
                    <div className="sidebar-filter-footer">
                      <span>
                        <ListFilter size={14} />
                        符合{" "}
                        {mode === "explore"
                          ? explorationProblems.length
                          : mode === "repeat"
                            ? repeatEligibleProblems.length
                          : filteredProblems.length}{" "}
                        題
                      </span>
                      <button
                        className="text-button"
                        onClick={() => setFilters(INITIAL_FILTERS)}
                      >
                        清除
                      </button>
                    </div>
                    <button
                      className="primary"
                      disabled={runnerBusy || forcedPracticeActive}
                      title={
                        forcedPracticeActive
                          ? "強迫模式進行中，不能重建 queue"
                          : undefined
                      }
                      onClick={() => {
                        if (forcedPracticeActive) return;
                        startSession();
                        setPersisted((previous) => ({
                          ...previous,
                          settings: {
                            ...previous.settings,
                            sidebarOpen: false
                          }
                        }));
                      }}
                    >
                      <Play size={14} /> 依照篩選開始
                    </button>
                  </div>
                )}
              </section>

              <TrainingDashboard
                open={persisted.settings.statsOpen}
                onToggle={handleStatsToggle}
                problems={indexData.problems}
                records={persisted.records}
                activity={persisted.activity}
                submissionHistory={persisted.submissionHistory}
                session={sessionStats}
                sessionGoal={sessionGoal}
                queueRemaining={queue.length}
                sessionElapsedSeconds={sessionElapsed}
                dueCount={dueCount}
                now={clockNow}
                dailyProgress={todayProgress}
              />

              <ErrorOverview
                open={persisted.settings.errorsOpen}
                onToggle={handleErrorsToggle}
                problems={indexData.problems}
                submissionHistory={persisted.submissionHistory}
              />

              <ProblemLibrary
                open={persisted.settings.libraryOpen}
                currentId={currentId}
                now={clockMinuteMs}
                problems={indexData.problems}
                records={persisted.records}
                filters={filters}
                onFiltersChange={handleLibraryFiltersChange}
                onClearFilters={handleLibraryClearFilters}
                selectionLocked={forcedPracticeActive}
                onToggle={handleLibraryToggle}
                onSelect={handleLibrarySelect}
              />
            </div>
          </aside>

          <article className="problem-panel">
            <div className="panel-header problem-heading">
              <div className="problem-heading-main">
                <button
                  ref={sidebarToggleRef}
                  className={`icon-button sidebar-toggle ${
                    persisted.settings.sidebarOpen ? "active" : ""
                  }`}
                  onClick={() =>
                    setPersisted((previous) => ({
                      ...previous,
                      settings: {
                        ...previous.settings,
                        sidebarOpen: !previous.settings.sidebarOpen
                      }
                    }))
                  }
                  title="開啟練習工具"
                >
                  <Menu size={18} />
                </button>
                <div>
                  <div className="eyebrow">
                    {problem.category}
                    <span>•</span>
                    {problem.sources.join(" / ")}
                  </div>
                  <h1>
                    <span>{problem.identity}</span>
                    {problem.title}
                  </h1>
                  <div className="problem-stats">
                    <span>提交 {record.attempts}</span>
                    <span>測資 AC {record.passed}</span>
                    <span>獨立 AC {record.memoryPassed ?? 0}</span>
                    <span>錯誤 {record.failed}</span>
                    <span>
                      最佳{" "}
                      {record.bestMs === undefined
                        ? "—"
                        : secondsLabel(record.bestMs / 1000)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="problem-actions">
                <span className={`difficulty ${problem.difficulty}`}>
                  {DIFFICULTY_LABEL[problem.difficulty]}
                </span>
                <button
                  className={`icon-button ${record.starred ? "starred" : ""}`}
                  onClick={() =>
                    updateRecord(problem.id, (current) => ({
                      ...current,
                      starred: !current.starred
                    }))
                  }
                  title="收藏"
                >
                  <Star size={17} fill={record.starred ? "currentColor" : "none"} />
                </button>
              </div>
            </div>

            <div className="problem-scroll">
              <section className="statement-section">
                <div className="section-kicker">
                  <span>PROBLEM</span>
                  <span>
                    {persisted.settings.language === "zh"
                      ? "繁體中文題目"
                      : "Original English"}
                  </span>
                </div>
                <MarkdownBlock
                  source={
                    persisted.settings.language === "zh"
                      ? problem.statementZh
                      : problem.statementEn
                  }
                />
              </section>

              <section className="personal-note-section">
                <div className="personal-note-toolbar">
                  <div className="personal-note-title">
                    <span>
                      <Code2 size={16} />
                      MY NOTES
                    </span>
                    <em className={noteSaveStatus}>
                      {noteSaveStatus === "saving"
                        ? "儲存中…"
                        : noteDraft.trim()
                          ? "已自動儲存"
                          : "每題獨立備忘錄"}
                    </em>
                  </div>
                  <div
                    className="personal-note-tabs"
                    role="tablist"
                    aria-label="個人筆記顯示模式"
                  >
                    <button
                      className={noteView === "source" ? "active" : ""}
                      role="tab"
                      aria-selected={noteView === "source"}
                      onClick={() => setNoteView("source")}
                    >
                      Source
                    </button>
                    <button
                      className={noteView === "preview" ? "active" : ""}
                      role="tab"
                      aria-selected={noteView === "preview"}
                      onClick={() => {
                        commitLatestNote();
                        setNoteView("preview");
                      }}
                    >
                      Preview
                    </button>
                  </div>
                </div>

                {noteView === "source" ? (
                  <div className="personal-note-source">
                    <textarea
                      value={noteDraft}
                      onChange={(event) =>
                        handleNoteChange(event.currentTarget.value)
                      }
                      onKeyDown={handleNoteKeyDown}
                      spellCheck={false}
                      aria-label={`${problem.identity} 個人 Markdown 筆記`}
                      placeholder={
                        "## 我的理解\n\n" +
                        "- 這題真正要維護什麼？\n" +
                        "- 邊界為什麼這樣寫？\n\n" +
                        "```python\n" +
                        "# 可以留下自己的主幹程式碼\n" +
                        "```"
                      }
                    />
                    <div className="personal-note-meta">
                      <span>
                        Markdown · [!NOTE] 可建立提示框 · Tab 插入兩格
                      </span>
                      <span>
                        {noteDraft.length.toLocaleString("zh-TW")} 字元 ·{" "}
                        ⌘/Ctrl + Enter 預覽
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="personal-note-preview">
                    {noteDraft.trim() ? (
                      <MarkdownBlock source={noteDraft} />
                    ) : (
                      <div className="personal-note-empty">
                        <Code2 size={20} />
                        <strong>這題還沒有個人筆記</strong>
                        <span>
                          切回 Source，留下你真正卡住的原因、邊界或重建口訣。
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className={`explanation-drawer ${!canReveal ? "locked" : ""}`}>
                <button
                  className="drawer-trigger"
                  disabled={!canReveal}
                  onClick={() => {
                    if (!persisted.settings.explanationOpen) {
                      recordAnswerReveal();
                    }
                    setPersisted((previous) => ({
                      ...previous,
                      settings: {
                        ...previous.settings,
                        explanationOpen: !previous.settings.explanationOpen
                      }
                    }));
                  }}
                >
                  <span>
                    <BookOpen size={17} />
                    Markdown 個人化題解
                    {!canReveal && <em>交卷後解鎖</em>}
                  </span>
                  <ChevronDown
                    size={17}
                    className={
                      persisted.settings.explanationOpen ? "rotated" : ""
                    }
                  />
                </button>
                {canReveal && persisted.settings.explanationOpen && (
                  <div className="explanation-content">
                    <PythonToolsSection
                      key={problem.id}
                      tools={problem.pythonTools}
                    />
                    <MarkdownBlock source={explanationMarkdown(problem)} />
                  </div>
                )}
              </section>
            </div>

            <footer className="problem-footer">
              <button
                onClick={goToPreviousProblem}
                disabled={
                  runnerBusy ||
                  mode === "speed" ||
                  mode === "repeat" ||
                  backHistory.length === 0
                }
              >
                <ChevronLeft size={15} />{" "}
                上一題
              </button>
              <div>
                <span>{labelForStatus(record.status)}</span>
                <span>
                  FSRS-{FSRS_ALGORITHM_VERSION} · {currentFamiliarity} ·{" "}
                  預估記憶率 {currentMemoryPercent}%
                </span>
                <span
                  className="problem-footer-memory-track"
                  title={`預估記憶率 ${currentMemoryPercent}%`}
                  role="progressbar"
                  aria-label="FSRS-7 預估記憶率"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={currentMemoryPercent}
                >
                  <span
                    style={{ width: `${currentMemoryPercent}%` }}
                  />
                </span>
                <span>
                  上次 {formatFsrsRating(record.fsrs?.last_rating)} ·{" "}
                  {formatDue(record.fsrs, currentReviewTime)}
                </span>
              </div>
              <button
                onClick={goToNextProblem}
                disabled={
                  runnerBusy ||
                  mode === "speed" ||
                  mode === "repeat" ||
                  queue.length <= 1
                }
              >
                下一題{" "}
                <ChevronRight size={15} />
              </button>
            </footer>
          </article>

          <button
            className="resize-handle"
            onMouseDown={() => setDragging(true)}
            aria-label="拖曳調整左右寬度"
          >
            <span />
          </button>

          <section
            className={`coding-panel ${
              resizingEditor ? "is-resizing-editor" : ""
            }`}
          >
            <div className="panel-header editor-heading">
              <div className="editor-tab active">
                <Code2 size={15} />
                solution.py
                <span className="dirty-dot" title="自動儲存到本機" />
              </div>
              <div className="editor-tools">
                <span className={`runtime-status ${runnerStatus}`}>
                  {formatting
                    ? "Ruff 格式化中…"
                    : runnerStatus === "runtime-loading"
                      ? "載入 Python Runtime…"
                      : runnerStatus === "executing"
                        ? "執行中（5 秒上限）"
                        : runnerStatus === "timeout"
                          ? "TLE"
                          : runnerStatus === "finished"
                            ? "測試完成"
                            : runnerStatus === "error"
                              ? "執行器錯誤"
                              : "Python 3"}
                </span>
                <div className="format-control">
                  <button
                    className={`icon-text-button ${
                      formatFeedback?.status === "error"
                        ? "format-error"
                        : formatFeedback
                          ? "format-success"
                          : ""
                    }`}
                    disabled={runnerBusy}
                    onClick={() => void formatCurrentCode()}
                    title={
                      formatFeedback?.message ??
                      "Ruff 格式化；Mac：Shift+Option+F"
                    }
                  >
                    <Braces size={14} />
                    {formatting
                      ? "格式化中"
                      : formatFeedback?.status === "formatted"
                        ? "已格式化"
                        : formatFeedback?.status === "unchanged"
                          ? "格式正確"
                          : formatFeedback?.status === "error"
                            ? "格式失敗"
                            : "格式化"}
                  </button>
                  <button
                    className={`format-settings-button ${
                      formatControlsOpen ? "active" : ""
                    }`}
                    disabled={formatting}
                    onClick={() => {
                      setAnswerControlsOpen(false);
                      setResetControlsOpen(false);
                      setFormatControlsOpen((previous) => !previous);
                    }}
                    aria-label="格式化設定"
                    aria-expanded={formatControlsOpen}
                    title="格式化設定"
                  >
                    <ChevronDown size={12} />
                  </button>
                  {formatControlsOpen && (
                    <div className="format-popover">
                      <header>
                        <strong>Python 格式化</strong>
                        <span>Ruff · Black 風格</span>
                      </header>
                      <label>
                        <input
                          type="checkbox"
                          checked={persisted.settings.formatOnSubmit}
                          disabled={
                            mode === "speed" || mode === "repeat"
                          }
                          onChange={(event) =>
                            setPersisted((previous) => ({
                              ...previous,
                              settings: {
                                ...previous.settings,
                                formatOnSubmit:
                                  event.currentTarget.checked
                              }
                            }))
                          }
                        />
                        <span>
                          <strong>送出前自動格式化</strong>
                          <small>
                            預設關閉；Speed／Repeat 固定只允許手動格式化
                          </small>
                        </span>
                      </label>
                      <p>
                        手動快捷鍵：Shift+Option+F。格式化只整理排版，不計入輸入量；Command/Ctrl+Z 可復原。
                      </p>
                    </div>
                  )}
                </div>
                <button
                  className={`icon-text-button ${
                    persisted.settings.answerOpen || repeatActive ? "active" : ""
                  }`}
                  disabled={!canReveal || repeatActive}
                  onClick={() => {
                    setResetControlsOpen(false);
                    if (persisted.settings.answerOpen) {
                      setAnswerControlsOpen(false);
                      setAnswerComparisonOpen(false);
                    } else {
                      recordAnswerReveal();
                    }
                    setFormatControlsOpen(false);
                    setPersisted((previous) => ({
                      ...previous,
                      settings: {
                        ...previous.settings,
                        answerOpen: !previous.settings.answerOpen
                      }
                    }));
                  }}
                  title={
                    repeatActive
                      ? `強迫重建第 ${repeatSession.stage + 1}/3 輪：答案固定顯示 ${repeatStagePercent}%`
                      : canReveal
                      ? "在編輯器底下顯示白色半透明答案片段"
                      : "模擬面試交卷後才能查看"
                  }
                >
                  {persisted.settings.answerOpen || repeatActive ? (
                    <Eye size={14} />
                  ) : (
                    <EyeOff size={14} />
                  )}
                  {repeatActive
                    ? "提示中"
                    : persisted.settings.answerOpen
                      ? "隱藏提示"
                      : "顯示提示"}
                </button>
                <button
                  className={`icon-text-button ${
                    answerComparisonOpen ? "active" : ""
                  }`}
                  disabled={
                    !canReveal ||
                    repeatActive ||
                    !persisted.settings.answerOpen
                  }
                  onClick={() => {
                    setAnswerControlsOpen(false);
                    setFormatControlsOpen(false);
                    setResetControlsOpen(false);
                    setAnswerComparisonOpen((previous) => !previous);
                  }}
                  title={
                    persisted.settings.answerOpen
                      ? "切換半透明底稿與左右並排答案"
                      : "請先開啟顯示提示"
                  }
                  aria-pressed={answerComparisonOpen}
                >
                  <Code2 size={14} />
                  {answerComparisonOpen ? "關閉並排" : "並排對照"}
                </button>
                <div className="answer-reveal-control">
                  <button
                    className={`icon-text-button ${
                      answerControlsOpen ? "active" : ""
                    }`}
                    disabled={!canReveal || repeatActive}
                    onClick={() => {
                      setFormatControlsOpen(false);
                      setResetControlsOpen(false);
                      setAnswerControlsOpen((previous) => !previous);
                    }}
                    title="調整答案揭露方式"
                    aria-expanded={answerControlsOpen}
                  >
                    <SlidersHorizontal size={14} />
                    {persisted.settings.adaptiveAnswerFade
                      ? `漸隱 ${effectiveAnswerRevealPercent}%`
                      : `${effectiveAnswerRevealPercent}%`}
                    <ChevronDown size={12} />
                  </button>

                  {answerControlsOpen && canReveal && (
                    <div className="answer-reveal-popover">
                      <header>
                        <strong>答案揭露</strong>
                        <span>Option+Enter 補目前行</span>
                      </header>

                      <label className="answer-fade-toggle">
                        <input
                          type="checkbox"
                          checked={persisted.settings.adaptiveAnswerFade}
                          onChange={(event) => {
                            const adaptiveAnswerFade =
                              event.currentTarget.checked;
                            if (!persisted.settings.answerOpen) {
                              recordAnswerReveal();
                            }
                            setPersisted((previous) => ({
                              ...previous,
                              settings: {
                                ...previous.settings,
                                answerOpen: true,
                                adaptiveAnswerFade
                              }
                            }));
                          }}
                        />
                        <span>
                          <strong>答案漸隱模式</strong>
                          <small>
                            AC 後依序 100%→75%→50%→25%→10%；剛失敗或快忘記時會暫時回升
                          </small>
                        </span>
                        <b>{effectiveAnswerRevealPercent}%</b>
                      </label>

                      <div className="answer-mode-options">
                        <button
                          disabled={persisted.settings.adaptiveAnswerFade}
                          className={
                            persisted.settings.answerRevealMode === "full"
                              ? "active"
                              : ""
                          }
                          onClick={() =>
                            {
                              if (!persisted.settings.answerOpen) {
                                recordAnswerReveal();
                              }
                              setPersisted((previous) => ({
                                ...previous,
                                settings: {
                                  ...previous.settings,
                                  answerOpen: true,
                                  answerRevealMode: "full"
                                }
                              }));
                            }
                          }
                        >
                          完整答案
                          <span>顯示 100%</span>
                        </button>
                        <button
                          disabled={persisted.settings.adaptiveAnswerFade}
                          className={
                            persisted.settings.answerRevealMode === "random"
                              ? "active"
                              : ""
                          }
                          onClick={() =>
                            {
                              if (!persisted.settings.answerOpen) {
                                recordAnswerReveal();
                              }
                              setPersisted((previous) => ({
                                ...previous,
                                settings: {
                                  ...previous.settings,
                                  answerOpen: true,
                                  answerRevealMode: "random"
                                }
                              }));
                            }
                          }
                        >
                          隨機片段
                          <span>依比例提示</span>
                        </button>
                      </div>

                      {!persisted.settings.adaptiveAnswerFade &&
                        persisted.settings.answerRevealMode === "random" && (
                        <div className="answer-percent-row">
                          <div className="answer-percent-label">
                            <span>目前顯示比例</span>
                            <strong>
                              {persisted.settings.answerRevealPercent}%
                            </strong>
                          </div>
                          <input
                            type="range"
                            min="10"
                            max="100"
                            step="10"
                            value={persisted.settings.answerRevealPercent}
                            onInput={(event) => {
                              const answerRevealPercent = Number(
                                event.currentTarget.value
                              );
                              if (!persisted.settings.answerOpen) {
                                recordAnswerReveal();
                              }
                              setPersisted((previous) => ({
                                ...previous,
                                settings: {
                                  ...previous.settings,
                                  answerOpen: true,
                                  answerRevealMode: "random",
                                  answerRevealPercent
                                }
                              }));
                            }}
                            aria-label="答案顯示百分比"
                          />
                          <button
                            className="answer-redraw"
                            onClick={() =>
                              setAnswerRevealSeed((previous) => previous + 1)
                            }
                          >
                            <Shuffle size={13} />
                            重抽片段
                          </button>
                        </div>
                      )}
                      {persisted.settings.adaptiveAnswerFade &&
                        effectiveAnswerRevealPercent < 100 && (
                          <button
                            className="answer-redraw adaptive"
                            onClick={() =>
                              setAnswerRevealSeed((previous) => previous + 1)
                            }
                          >
                            <Shuffle size={13} />
                            重抽目前提示片段
                          </button>
                        )}
                      <div className="answer-brightness-row">
                        <div className="answer-percent-label">
                          <span>漂浮提示亮度</span>
                          <strong>
                            {persisted.settings.answerBrightness}%
                          </strong>
                        </div>
                        <input
                          type="range"
                          min="5"
                          max="100"
                          step="1"
                          value={persisted.settings.answerBrightness}
                          onInput={(event) => {
                            const answerBrightness = Number(
                              event.currentTarget.value
                            );
                            if (!persisted.settings.answerOpen) {
                              recordAnswerReveal();
                            }
                            setPersisted((previous) => ({
                              ...previous,
                              settings: {
                                ...previous.settings,
                                answerOpen: true,
                                answerBrightness
                              }
                            }));
                          }}
                          aria-label="漂浮答案亮度"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="reset-control">
                  <button
                    className={`icon-text-button ${
                      resetControlsOpen ? "active" : ""
                    }`}
                    disabled={
                      runnerBusy
                    }
                    onClick={() => {
                      setAnswerControlsOpen(false);
                      setFormatControlsOpen(false);
                      setResetControlsOpen((previous) => !previous);
                    }}
                    aria-expanded={resetControlsOpen}
                    title="Option+R 還原骨架；也可清除本題全部紀錄"
                  >
                    <RotateCcw size={14} /> 重設
                    <ChevronDown size={12} />
                  </button>
                  {resetControlsOpen && (
                    <div className="reset-popover">
                      <header>
                        <strong>重設這一題</strong>
                        <span>請選擇清除範圍</span>
                      </header>
                      <button onClick={resetCurrentCode}>
                        <Code2 size={15} />
                        <span>
                          <strong>只重設程式碼</strong>
                          <small>
                            Option+R；保留提交與複習紀錄
                          </small>
                        </span>
                      </button>
                      <button
                        className="danger"
                        onClick={clearCurrentProblemHistory}
                      >
                        <History size={15} />
                        <span>
                          <strong>清除本題全部紀錄</strong>
                          <small>
                            刪除草稿、提交、統計與 FSRS 排程
                          </small>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="editor-primary-actions">
                  <button
                    className="secondary"
                    onClick={skip}
                    disabled={
                      runnerBusy ||
                      mode === "speed" ||
                      mode === "repeat"
                    }
                    title="Mac：fn+F10；通用：⌘/Ctrl+Shift+Enter"
                  >
                    <SkipForward size={15} />
                    {mode === "speed" || mode === "repeat" ? "強迫中" : "跳過"}
                  </button>
                  <button
                    className="run-button"
                    onClick={() => void execute()}
                    disabled={
                      runnerBusy
                    }
                    title="Mac：fn+F9；通用：⌘/Ctrl+Enter"
                  >
                    <Play size={15} />
                    {mode === "interview"
                      ? "交卷"
                      : speedTimedOut
                        ? "重打後執行"
                        : "執行"}
                  </button>
                </div>
              </div>
            </div>

            {mode === "speed" && speedFeedback && (
              <div
                className={`speed-feedback ${speedFeedback.kind}`}
                role="status"
              >
                <Zap size={15} />
                <span>{speedFeedback.message}</span>
              </div>
            )}

            {mode === "repeat" && repeatFeedback && (
              <div
                className={`speed-feedback ${repeatFeedback.kind}`}
                role="status"
              >
                <RotateCcw size={15} />
                <span>{repeatFeedback.message}</span>
              </div>
            )}

            {latestFailedResult && (
              <div
                className={`run-failure-summary ${
                  latestErrorLine ? "jumpable" : ""
                }`}
                role={latestErrorLine ? "button" : "alert"}
                tabIndex={latestErrorLine ? 0 : undefined}
                aria-label={
                  latestErrorLine
                    ? `${latestFailureReason}；跳到第 ${latestErrorLine} 行`
                    : undefined
                }
                onClick={() => {
                  if (latestErrorLine) {
                    codeEditorRef.current?.focusErrorLine(latestErrorLine);
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    latestErrorLine &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    codeEditorRef.current?.focusErrorLine(latestErrorLine);
                  }
                }}
              >
                <AlertTriangle size={15} />
                <strong>
                  {latestFailedResult.errorType === "Runner Error"
                    ? "未計入嘗試"
                    : `第 ${record.attempts} 次嘗試`}
                </strong>
                <em>
                  {latestFailedResult.errorType ?? "Wrong Answer"}
                </em>
                <span title={latestFailureReason}>
                  {latestFailureReason}
                </span>
                {latestErrorLine && (
                  <small>第 {latestErrorLine} 行 · 點擊定位</small>
                )}
              </div>
            )}

            {answerComparisonActive && (
              <div className="answer-comparison-toolbar">
                <div>
                  <Code2 size={14} />
                  <strong>我的程式碼</strong>
                  <small>在這一側直接修改</small>
                </div>
                <div>
                  <Braces size={14} />
                  <strong>
                    {effectiveAnswerRevealMode === "full"
                      ? "AC 答案"
                      : `答案片段 ${effectiveAnswerRevealPercent}%`}
                  </strong>
                  <small>兩側捲動已同步</small>
                  <button
                    className="icon-text-button"
                    onClick={() =>
                      void navigator.clipboard.writeText(revealedAnswer)
                    }
                    title="複製目前顯示的答案"
                  >
                    <Copy size={13} />
                    複製
                  </button>
                </div>
              </div>
            )}

            <div
              className={`editor-stage ${
                answerComparisonActive ? "is-comparing" : ""
              }`}
              style={
                {
                  "--preferred-editor-height": `${persisted.settings.editorHeight}px`
                } as React.CSSProperties
              }
            >
              <CodeEditor
                ref={codeEditorRef}
                key={`${problem.id}-${editorRevision}`}
                initialValue={code}
                answer={revealedAnswer}
                overlaySyncToken={
                  results.length
                    ? results
                        .map(
                          (result) =>
                            `${result.name}:${result.passed}:${result.errorType ?? ""}:${result.error ?? ""}`
                        )
                        .join("|")
                    : "idle"
                }
                showAnswerOverlay={
                  answerOverlayActive
                }
                comparisonMode={answerComparisonActive}
                answerBrightness={persisted.settings.answerBrightness}
                onChange={handleCodeChange}
                onEditTelemetry={recordEditorTelemetry}
                onHintUsed={recordHintUse}
                onFormatStart={handleFormatStart}
                onFormatResult={handleFormatResult}
              />
            </div>

            {!answerComparisonActive && (
              <button
                className="editor-height-handle"
                onPointerDown={(event) => {
                  event.preventDefault();
                  editorResizeStartRef.current = {
                    y: event.clientY,
                    height: persisted.settings.editorHeight
                  };
                  setResizingEditor(true);
                }}
                aria-label="上下拖曳調整 editor 高度"
                title="上下拖曳調整 editor 高度"
              >
                <span />
              </button>
            )}

            <SubmissionHistoryDrawer
              attempts={record.attempts}
              open={problemHistoryOpen}
              submissions={currentSubmissionHistory}
              onToggle={() =>
                setProblemHistoryOpen((previous) => !previous)
              }
            />

            <section className="test-console">
              <div className="console-header">
                <div>
                  <TerminalSquare size={16} />
                  <strong>測資與執行結果</strong>
                  <span>{allTests.length} 組</span>
                </div>
                <div>
                  <button
                    className="text-button"
                    onClick={() => setShowCustomTest((value) => !value)}
                  >
                    + 自訂測資
                  </button>
                </div>
              </div>

              {showCustomTest && (
                <div className="custom-test-editor">
                  <label>
                    輸入
                    <textarea
                      value={customInput}
                      onChange={(event) => setCustomInput(event.target.value)}
                      placeholder="nums = [1,2,3], k = 2"
                    />
                  </label>
                  <label>
                    預期輸出
                    <textarea
                      value={customExpected}
                      onChange={(event) => setCustomExpected(event.target.value)}
                      placeholder="[2,3]"
                    />
                  </label>
                  <button className="primary small" onClick={addCustomTest}>
                    加入測試
                  </button>
                </div>
              )}

              <div className="test-list">
                {!results.length ? (
                  <>
                    {allTests.slice(0, 3).map((test) => (
                      <div className="test-preview" key={`${test.name}-${test.input}`}>
                        <span>{test.name}</span>
                        <code>{test.input}</code>
                        {"id" in test && (
                          <button
                            onClick={() =>
                              removeCustomTest((test as CustomTestCase).id)
                            }
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                    {!allTests.length && (
                      <p className="console-empty">
                        這題未能自動擷取官方範例；新增一組測資後即可真實執行。
                      </p>
                    )}
                  </>
                ) : (
                  results.map((result, index) => (
                    <div
                      className={`test-result ${result.passed ? "passed" : "failed"}`}
                      key={`${result.name}-${index}`}
                    >
                      <div className="result-title">
                        <span>{result.passed ? <Check size={15} /> : <X size={15} />}</span>
                        <strong>{result.name}</strong>
                        <em>
                          {result.passed
                            ? "Accepted"
                            : result.errorType ?? "Wrong Answer"}
                        </em>
                      </div>
                      {result.error ? (
                        <>
                          {result.input && (
                            <div className="result-input">
                              <span>Input</span>
                              <code>{result.input}</code>
                            </div>
                          )}
                          <pre>{result.error}</pre>
                        </>
                      ) : (
                        <>
                          {result.input && (
                            <div className="result-input">
                              <span>Input</span>
                              <code>{result.input}</code>
                            </div>
                          )}
                          <div className="result-values">
                            <span>
                              實際 <code>{result.actual}</code>
                            </span>
                            <span>
                              預期 <code>{result.expected}</code>
                            </span>
                          </div>
                        </>
                      )}
                      {result.stdout && (
                        <pre className="stdout">stdout: {result.stdout}</pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

            {mode === "interview" && submitted && (
              <section className="interview-result">
                <div>
                  <strong>{allPassed ? "本題通過" : "本題未通過"}</strong>
                  <span>
                    用時 {secondsLabel(latestSubmissionElapsed)} ·
                    本輪通過率{" "}
                    {sessionStats.attempted
                      ? Math.round(
                          (sessionStats.passed / sessionStats.attempted) * 100
                        )
                      : 0}
                    %
                  </span>
                </div>
                <button
                  className="primary"
                  onClick={() =>
                    moveToNext(
                      allPassed ? "completed" : "deferred",
                      allPassed
                    )
                  }
                >
                  {allPassed ? "下一題" : "稍後重試"}
                  <ChevronRight size={15} />
                </button>
              </section>
            )}

          </section>
        </section>
      )}

      <footer className="statusbar">
        <span>
          <span className="status-dot" />
          草稿已自動儲存在本機
        </span>
        <span>
          本輪 {sessionStats.passed} 通過 · {sessionStats.failed} 失敗 ·{" "}
          {sessionStats.skipped} 跳過
        </span>
        <span>
          ⇧⌥F 格式化　Option+Enter 補答案行　⌥R 還原骨架　fn+F8 上一題　fn+F9 或 ⌘↵ 執行　fn+F10 或 ⌘⇧↵ 跳過
        </span>
      </footer>
      </main>
    </>
  );
}
