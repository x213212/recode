import type { RecallRound } from "./recallRound";

export type Difficulty = "easy" | "medium" | "hard" | "unknown";
export type StudyStatus = "new" | "learning" | "retry" | "completed" | "mastered";
export type PracticeMode =
  | "guided"
  | "free"
  | "explore"
  | "interview"
  | "speed"
  | "repeat";
export type StatementLanguage = "zh" | "en";
export type FsrsRating = "again" | "hard" | "good" | "easy";
export type ReviewOrigin =
  | "new"
  | "retry"
  | "fsrs-due"
  | "checkpoint-due"
  | "early"
  | "manual"
  | "same-session";
export type AnswerRevealMode = "full" | "random";
export type TrainingMenuSize = "light" | "standard" | "intensive";
export type TrainingPlanPhase =
  | "foundation"
  | "patterns"
  | "transfer"
  | "interview";
export type TrainingBlockKind =
  | "recall"
  | "learn"
  | "transfer"
  | "speed"
  | "interview";
export type TrainingBlockStatus = "pending" | "running" | "completed";
export type DailyTrainingPlanStatus =
  | "ready"
  | "running"
  | "paused"
  | "completed";

export interface ProblemSummary {
  id: string;
  order: number;
  identity: string;
  title: string;
  category: string;
  difficulty: Difficulty;
  sources: string[];
  testCount: number;
  runnable: boolean;
}

export interface TestCase {
  name: string;
  input: string;
  expected: string;
}

export interface PythonToolInfo {
  id: string;
  name: string;
  note: string;
  example: string;
}

export interface ProblemDetail extends ProblemSummary {
  url: string;
  statementZh: string;
  statementEn: string;
  goal: string;
  memoryCard: string;
  premise: string;
  facts: string;
  friction: string;
  state: string;
  diagram: string;
  route: string;
  derivation: string;
  proof: string;
  trace: string;
  wrongAlternative: string;
  rebuild: string;
  memoryLine: string;
  standaloneSummary: string;
  /** 本題 AC 程式碼用到的 Python 工具小卡；舊版 JSON 沒有此欄位。 */
  pythonTools?: PythonToolInfo[];
  answer: string;
  starter: string;
  overlayAnswer: string;
  tests: TestCase[];
  unorderedOutput: boolean;
}

export interface StudyRecord {
  status: StudyStatus;
  attempts: number;
  passed: number;
  /** 沒有答案協助、可作為記憶證據的 AC 次數。 */
  memoryPassed?: number;
  /** 看過答案或 Repeat 跟打後的 AC 次數。 */
  assistedPassed?: number;
  failed: number;
  hints: number;
  streak: number;
  totalMs: number;
  bestMs?: number;
  lastStudiedAt?: string;
  starred?: boolean;
  /** Repeat 完成後安排的延遲 0% 提示驗收。 */
  recallCheckpointDue?: string;
  fsrs?: FsrsCardData;
}

export interface FsrsCardData {
  algorithm_version?: 7;
  /** 精確公式／參數修訂；algorithm_version 相同也可能有參數差異。 */
  scheduler_revision?: string;
  last_rating?: FsrsRating;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
}

export interface CustomTestCase extends TestCase {
  id: string;
}

export interface DailyActivity {
  submissions: number;
  passed: number;
  failed: number;
  totalMs: number;
}

export interface SubmissionEvent {
  id: string;
  /** 同一輪的 WA／AC 共用一個 ID，避免把每次送出都當成一次回想。 */
  roundId?: string;
  problemId: string;
  submittedAt: string;
  passed: boolean;
  durationMs: number;
  hintsUsed?: number;
  insertedChars?: number;
  deletedChars?: number;
  editOperations?: number;
  resetCount?: number;
  answerRevealCount?: number;
  reviewStruggleScore?: number;
  timeRatio?: number;
  rewriteRatio?: number;
  /** 這次送出前，FSRS 對本題的預估記憶率。新題沒有此欄位。 */
  predictedRecall?: number;
  /** 評分時使用的個人校準樣本數與偏差，供日後審計。 */
  calibrationSampleSize?: number;
  calibrationBias?: number;
  inferredRating?: FsrsRating;
  practiceMode?: PracticeMode;
  /** 送出當下為何會看到這題；可審計提前／同回合重做是否被隔離。 */
  reviewOrigin?: ReviewOrigin;
  /**
   * true 代表這次提交可作為「沒有答案協助的提取」證據。
   * false 仍保留練習紀錄，但不可以推高 FSRS 或答案淡出進度。
   * 舊紀錄沒有此欄位時，依舊版規則視為可用，除非能確定當時看過答案。
   */
  memoryEligible?: boolean;
  memoryEvidenceReason?:
    | "independent-recall"
    | "answer-assisted"
    | "repeat-guided"
    | "speed-answer-visible"
    | "speed-timeout-rewrite"
    | "speed-late-submit"
    | "early-review"
    | "same-session-repeat"
    | "manual-review"
    | "legacy-assisted";
  code?: string;
  results?: TestResult[];
}

export interface AttemptTimerState {
  started: boolean;
  elapsedMs: number;
  runningSince?: number;
}

export interface DailyTrainingBlock {
  id: string;
  kind: TrainingBlockKind;
  mode: PracticeMode;
  title: string;
  purpose: string;
  targetCount: number;
  problemIds: string[];
  remainingProblemIds: string[];
  status: TrainingBlockStatus;
}

export interface DailyTrainingPlan {
  id: string;
  date: string;
  planDay: number;
  phase: TrainingPlanPhase;
  focusCategories: string[];
  preset: TrainingMenuSize;
  estimatedMinutes: number;
  status: DailyTrainingPlanStatus;
  activeBlockIndex: number;
  blocks: DailyTrainingBlock[];
  createdAt: string;
  completedAt?: string;
}

export interface CompletedTrainingDay {
  planDay: number;
  preset: TrainingMenuSize;
  completedAt: string;
  completedBlocks: number;
  problemCount: number;
}

export interface TrainingProgramState {
  preset: TrainingMenuSize;
  startedOn?: string;
  activePlan?: DailyTrainingPlan;
  completedDays: Record<string, CompletedTrainingDay>;
}

export interface PersistedState {
  version: 6;
  drafts: Record<string, string>;
  notes: Record<string, string>;
  records: Record<string, StudyRecord>;
  customTests: Record<string, CustomTestCase[]>;
  activity: Record<string, DailyActivity>;
  submissionHistory: SubmissionEvent[];
  /** 有意義操作才開始；導覽 queue 不等於已作答。 */
  recallRounds: RecallRound[];
  training: TrainingProgramState;
  session: {
    queue: string[];
    backHistory: string[];
    currentProblemId?: string;
    results: TestResult[];
    submitted: boolean;
    initialTotal: number;
    startedAt?: number;
    problemStartedAt?: number;
    problemTimer?: AttemptTimerState;
    attempted: number;
    passed: number;
    failed: number;
    skipped: number;
    totalMs: number;
    speed: {
      phase: "setup" | "running" | "timeout" | "finished";
      questionLimitMs: number;
      total: number;
      score: number;
      solved: number;
      timedOut: number;
      wrongAttempts: number;
      deadlineAt?: number;
      questionId?: string;
      categories: Record<
        string,
        {
          solved: number;
          timedOut: number;
          wrongAttempts: number;
          points: number;
        }
      >;
    };
    repeat: {
      phase: "idle" | "running" | "finished";
      stage: number;
      total: number;
      completed: number;
      failedStages: number;
    };
  };
  settings: {
    filterOpen: boolean;
    answerOpen: boolean;
    answerReferenceOpen: boolean;
    explanationOpen: boolean;
    statsOpen: boolean;
    errorsOpen: boolean;
    libraryOpen: boolean;
    sidebarOpen: boolean;
    adaptiveAnswerFade: boolean;
    answerRevealMode: AnswerRevealMode;
    answerRevealPercent: number;
    answerBrightness: number;
    editorHeight: number;
    leftPercent: number;
    language: StatementLanguage;
    mode: PracticeMode;
    sessionSize: number;
    speedAnswerVisible: boolean;
    speedQuestionSeconds: number;
    formatOnSubmit: boolean;
    interviewMinutes: number;
    randomOrder: boolean;
    filters: {
      query: string;
      category: string;
      source: string;
      difficulty:
        | "all"
        | Difficulty
        | "easy-medium"
        | "medium-hard"
        | "known";
      status:
        | "all"
        | StudyStatus
        | "due"
        | "starred"
        | "solved";
    };
  };
}

export interface TestResult {
  name: string;
  passed: boolean;
  errorType?: "Syntax Error" | "Runtime Error" | "Wrong Answer" | "TLE" | "Runner Error";
  input?: string;
  actual?: string;
  expected?: string;
  error?: string;
  stdout?: string;
}

export interface ProblemIndex {
  version: number;
  generatedFrom: string;
  total: number;
  categories: string[];
  sources: string[];
  problems: ProblemSummary[];
}
