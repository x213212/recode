"use client";

import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock3,
  RotateCcw,
  Search,
  Star
} from "lucide-react";
import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Ref
} from "react";

import {
  type DifficultyFilter,
  independentPassCount,
  isProblemDue,
  matchesDifficultyFilter,
  matchesProblemLibraryQuery,
  problemLibraryRank
} from "@/lib/review";
import {
  FSRS_ALGORITHM_VERSION,
  familiarityLabel,
  retrievability
} from "@/lib/fsrs";
import type {
  Difficulty,
  ProblemSummary,
  StudyRecord,
  StudyStatus
} from "@/lib/types";

interface ProblemLibraryFilters {
  query: string;
  category: string;
  source: string;
  difficulty: DifficultyFilter;
  status: "all" | StudyStatus | "due" | "starred" | "solved";
}

interface ProblemLibraryProps {
  open: boolean;
  currentId: string;
  now: number;
  problems: ProblemSummary[];
  records: Record<string, StudyRecord>;
  filters: ProblemLibraryFilters;
  onFiltersChange: (updates: Partial<ProblemLibraryFilters>) => void;
  onClearFilters: () => void;
  onToggle: () => void;
  onSelect: (id: string) => void;
  selectionLocked?: boolean;
}

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: "簡單",
  medium: "中等",
  hard: "困難",
  unknown: "未標示"
};

function elapsedLabel(milliseconds: number | undefined): string {
  if (milliseconds === undefined) return "—";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function summarizeProblems(
  problems: ProblemSummary[],
  records: Record<string, StudyRecord>,
  reviewTime: Date
) {
  return problems.reduce(
    (totals, problem) => {
      const record = records[problem.id];
      const attempts = record?.attempts ?? 0;
      const hasMemory =
        record?.fsrs?.algorithm_version === FSRS_ALGORITHM_VERSION;
      totals.attempts += attempts;
      totals.passed += record?.passed ?? 0;
      totals.failed += record?.failed ?? 0;
      if (hasMemory) {
        totals.scheduled += 1;
        totals.memory += retrievability(record.fsrs, reviewTime);
      }
      if (attempts > 0 || record?.status === "learning") {
        totals.practiced += 1;
      }
      return totals;
    },
    {
      practiced: 0,
      attempts: 0,
      passed: 0,
      failed: 0,
      scheduled: 0,
      memory: 0
    }
  );
}

function averageMemoryPercent(totals: {
  scheduled: number;
  memory: number;
}) {
  return totals.scheduled
    ? Math.round((totals.memory / totals.scheduled) * 100)
    : 0;
}

interface ProblemRowProps {
  id: string;
  identity: string;
  title: string;
  difficulty: Difficulty;
  isCurrent: boolean;
  disabled: boolean;
  starred: boolean;
  solved: boolean;
  attempting: boolean;
  attempts: number;
  passed: number;
  failed: number;
  memoryPassed: number;
  bestLabel: string;
  memory: number;
  familiarity: string;
  rowRef: Ref<HTMLButtonElement> | undefined;
  onSelect: (id: string) => void;
}

const ProblemRow = memo(function ProblemRow({
  id,
  identity,
  title,
  difficulty,
  isCurrent,
  disabled,
  starred,
  solved,
  attempting,
  attempts,
  passed,
  failed,
  memoryPassed,
  bestLabel,
  memory,
  familiarity,
  rowRef,
  onSelect
}: ProblemRowProps) {
  return (
    <button
      ref={rowRef}
      className={`problem-library-problem ${
        isCurrent ? "current" : ""
      }`}
      disabled={disabled}
      title={
        disabled
          ? "強迫模式進行中，完成目前題目後才能切題"
          : undefined
      }
      onClick={() => onSelect(id)}
    >
      <span className="problem-library-title">
        {starred && (
          <Star
            size={11}
            fill="currentColor"
            aria-label="重點題"
          />
        )}
        <strong>{identity}</strong>
        <span>{title}</span>
        <em className="problem-library-memory-title">
          {familiarity} {memory}%
        </em>
      </span>
      <span className="problem-library-meta">
        <em
          className={
            solved
              ? "solved"
              : attempting
                ? "attempting"
                : "retry"
          }
        >
          {solved ? (
            <CheckCircle2 size={11} />
          ) : attempting ? (
            <Clock3 size={11} />
          ) : (
            <RotateCcw size={11} />
          )}
          {solved
            ? "已通過"
            : attempting
              ? "嘗試中"
              : attempts === 0
                ? "尚未解決"
                : "待重刷"}
        </em>
        <span>{DIFFICULTY_LABEL[difficulty]}</span>
        <span>提交 {attempts}</span>
        <span className="passed">測資 AC {passed}</span>
        <span className="passed">
          獨立 AC {memoryPassed}
        </span>
        <span className="failed">錯誤 {failed}</span>
        <span>
          <Clock3 size={10} />
          最佳 {bestLabel}
        </span>
      </span>
      <span
        className="problem-library-memory-track"
        title={`FSRS-7 預估記憶率 ${memory}%`}
        aria-label={`FSRS-7 預估記憶率 ${memory}%`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={memory}
      >
        <span style={{ width: `${memory}%` }} />
      </span>
    </button>
  );
});

function ProblemLibrary({
  open,
  currentId,
  now,
  problems,
  records,
  filters,
  onFiltersChange,
  onClearFilters,
  onToggle,
  onSelect,
  selectionLocked = false
}: ProblemLibraryProps) {
  const currentCategory =
    problems.find((problem) => problem.id === currentId)?.category ?? "";
  const reviewTime = useMemo(() => new Date(now), [now]);
  // 輸入框顯示即時值；昂貴的過濾與展開改用 deferred 值，避免打字卡頓。
  const deferredQuery = useDeferredValue(filters.query);
  const normalizedLibraryQuery = deferredQuery.trim().toLowerCase();
  const categoryOptions = useMemo(
    () => Array.from(new Set(problems.map((problem) => problem.category))),
    [problems]
  );
  const sourceOptions = useMemo(
    () => Array.from(new Set(problems.flatMap((problem) => problem.sources))),
    [problems]
  );
  const selectFiltersActive =
    filters.category !== "all" ||
    filters.source !== "all" ||
    filters.difficulty !== "all" ||
    filters.status !== "all";
  // 即時值：驅動「清除所有篩選」按鈕，行為與原本一致（打第一個字立即可按）。
  const filtersActive =
    Boolean(filters.query.trim()) || selectFiltersActive;
  // deferred 值：驅動分類展開與清單內容，兩者永遠同步。
  const deferredFiltersActive =
    Boolean(normalizedLibraryQuery) || selectFiltersActive;
  const matchingProblems = useMemo(() => {
    return problems.filter((problem) => {
      if (
        normalizedLibraryQuery &&
        !matchesProblemLibraryQuery(problem, normalizedLibraryQuery)
      ) {
        return false;
      }
      if (
        filters.category !== "all" &&
        problem.category !== filters.category
      ) {
        return false;
      }
      if (
        filters.source !== "all" &&
        !problem.sources.includes(filters.source)
      ) {
        return false;
      }
      if (
        !matchesDifficultyFilter(problem.difficulty, filters.difficulty)
      ) {
        return false;
      }

      const record = records[problem.id];
      if (
        filters.status === "due" &&
        !isProblemDue(problem, records, reviewTime)
      ) {
        return false;
      }
      if (filters.status === "starred" && !record?.starred) {
        return false;
      }
      // 已解決 = 至少一次沒有答案協助的 AC。
      if (
        filters.status === "solved" &&
        independentPassCount(record) <= 0
      ) {
        return false;
      }
      if (
        !["all", "due", "starred", "solved"].includes(filters.status) &&
        (record?.status ?? "new") !== filters.status
      ) {
        return false;
      }
      return true;
    });
  }, [
    filters.category,
    filters.difficulty,
    filters.source,
    filters.status,
    normalizedLibraryQuery,
    problems,
    records,
    reviewTime
  ]);
  const groups = useMemo(() => {
    const sortGroupProblems = (groupProblems: ProblemSummary[]) =>
      [...groupProblems].sort((first, second) => {
        const firstRank = problemLibraryRank(records[first.id]);
        const secondRank = problemLibraryRank(records[second.id]);
        if (firstRank !== secondRank) return firstRank - secondRank;

        const firstStarred = records[first.id]?.starred ? 1 : 0;
        const secondStarred = records[second.id]?.starred ? 1 : 0;
        if (firstStarred !== secondStarred) {
          return secondStarred - firstStarred;
        }
        return first.order - second.order;
      });

    const grouped = new Map<string, ProblemSummary[]>();
    for (const problem of matchingProblems) {
      const categoryProblems = grouped.get(problem.category) ?? [];
      categoryProblems.push(problem);
      grouped.set(problem.category, categoryProblems);
    }

    const categoryGroups = Array.from(
      grouped,
      ([category, categoryProblems], groupOrder) => {
        const sorted = sortGroupProblems(categoryProblems);
        return {
          key: category,
          category,
          favorites: false,
          solvedGroup: false,
          problems: sorted,
          order: groupOrder,
          starred: sorted.filter(
            (problem) => records[problem.id]?.starred
          ).length,
          attempts: sorted.reduce(
            (total, problem) =>
              total + (records[problem.id]?.attempts ?? 0),
            0
          )
        };
      }
    ).sort((first, second) => {
      if (first.category === currentCategory) return -1;
      if (second.category === currentCategory) return 1;
      if (first.starred !== second.starred) {
        return second.starred - first.starred;
      }
      return first.order - second.order;
    });

    const favoriteProblems = sortGroupProblems(
      matchingProblems.filter((problem) => records[problem.id]?.starred)
    );
    const solvedProblems = sortGroupProblems(
      matchingProblems.filter(
        (problem) => independentPassCount(records[problem.id]) > 0
      )
    );

    const specialGroups = [];
    // 已經選「已解決」篩選時，分類本身就全是已解決題，不再重複一組。
    if (solvedProblems.length && filters.status !== "solved") {
      specialGroups.push({
        key: "__solved__",
        category: "✓ 已解決",
        favorites: false,
        solvedGroup: true,
        problems: solvedProblems,
        order: -2,
        starred: solvedProblems.filter(
          (problem) => records[problem.id]?.starred
        ).length,
        attempts: solvedProblems.reduce(
          (total, problem) => total + (records[problem.id]?.attempts ?? 0),
          0
        )
      });
    }
    if (favoriteProblems.length) {
      specialGroups.push({
        key: "__favorites__",
        category: "★ 收藏",
        favorites: true,
        solvedGroup: false,
        problems: favoriteProblems,
        order: -1,
        starred: favoriteProblems.length,
        attempts: favoriteProblems.reduce(
          (total, problem) => total + (records[problem.id]?.attempts ?? 0),
          0
        )
      });
    }

    return [...specialGroups, ...categoryGroups];
  }, [currentCategory, filters.status, matchingProblems, records]);

  const [openCategory, setOpenCategory] = useState(
    currentCategory || groups[0]?.key || ""
  );
  const previousCurrentCategoryRef = useRef(currentCategory);
  const previousOpenRef = useRef(open);
  const currentProblemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (
      currentCategory &&
      currentCategory !== previousCurrentCategoryRef.current
    ) {
      previousCurrentCategoryRef.current = currentCategory;
      setOpenCategory(currentCategory);
    }
  }, [currentCategory]);

  useEffect(() => {
    if (open && !previousOpenRef.current && currentCategory) {
      setOpenCategory(currentCategory);
    }
    previousOpenRef.current = open;
  }, [currentCategory, open]);

  useEffect(() => {
    if (!open || openCategory !== currentCategory) return;
    const frame = requestAnimationFrame(() => {
      currentProblemRef.current?.scrollIntoView({
        block: "nearest"
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentCategory, currentId, open, openCategory]);

  const starredTotal = problems.reduce(
    (total, problem) =>
      total + (records[problem.id]?.starred ? 1 : 0),
    0
  );
  const matchingTotal = matchingProblems.length;
  const libraryTotals = useMemo(
    () => summarizeProblems(problems, records, reviewTime),
    [problems, records, reviewTime]
  );
  const matchingTotals = useMemo(
    () => summarizeProblems(matchingProblems, records, reviewTime),
    [matchingProblems, records, reviewTime]
  );
  const averageMemory = averageMemoryPercent(libraryTotals);
  const matchingAverageMemory = averageMemoryPercent(matchingTotals);

  return (
    <section className={`problem-library-drawer ${open ? "open" : ""}`}>
      <button className="problem-library-trigger" onClick={onToggle}>
        <span>
          <BookOpen size={16} />
          <strong>總題庫</strong>
          <em>
            {problems.length} 題 · 已練 {libraryTotals.practiced} 題 · 提交{" "}
            {libraryTotals.attempts} 次 · FSRS 預估 {averageMemory}% ·{" "}
            {starredTotal} 題重點
          </em>
        </span>
        <ChevronDown size={17} className={open ? "rotated" : ""} />
      </button>

      {open && (
        <div className="problem-library-groups">
          <div className="problem-library-toolbar">
            <div className="problem-library-search-row">
              <label className="search-field">
                <Search size={15} />
                <input
                  type="search"
                  value={filters.query}
                  onChange={(event) =>
                    onFiltersChange({
                      query: event.currentTarget.value
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Escape" || !filters.query) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onFiltersChange({ query: "" });
                  }}
                  placeholder="搜尋題號、題名、題型或題單"
                  aria-label="搜尋總題庫"
                />
              </label>
              <span>
                {matchingTotal}/{problems.length}
              </span>
            </div>
            <div className="problem-library-filter-grid">
              <label>
                <span>題型</span>
                <select
                  value={filters.category}
                  onChange={(event) =>
                    onFiltersChange({
                      category: event.currentTarget.value
                    })
                  }
                  aria-label="總題庫題型"
                >
                  <option value="all">全部題型</option>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>題單／書籍</span>
                <select
                  value={filters.source}
                  onChange={(event) =>
                    onFiltersChange({
                      source: event.currentTarget.value
                    })
                  }
                  aria-label="總題庫題單或書籍"
                >
                  <option value="all">全部題單</option>
                  {sourceOptions.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>難度</span>
                <select
                  value={filters.difficulty}
                  onChange={(event) =>
                    onFiltersChange({
                      difficulty: event.currentTarget
                        .value as DifficultyFilter
                    })
                  }
                  aria-label="總題庫難度"
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
              </label>
              <label>
                <span>進度／收藏</span>
                <select
                  value={filters.status}
                  onChange={(event) =>
                    onFiltersChange({
                      status: event.currentTarget
                        .value as ProblemLibraryFilters["status"]
                    })
                  }
                  aria-label="總題庫進度或收藏"
                >
                  <option value="all">全部狀態</option>
                  <option value="due">今天到期</option>
                  <option value="solved">已解決（曾 AC）</option>
                  <option value="new">未開始</option>
                  <option value="learning">嘗試中</option>
                  <option value="retry">需要重刷</option>
                  <option value="completed">已完成</option>
                  <option value="mastered">已掌握</option>
                  <option value="starred">★ 已收藏</option>
                </select>
              </label>
              <button
                className="problem-library-clear"
                onClick={onClearFilters}
                disabled={!filtersActive}
              >
                <RotateCcw size={12} />
                清除所有篩選
              </button>
            </div>
          </div>
          <div className="problem-library-summary">
            <span>
              <small>練習題數</small>
              <strong>{matchingTotals.practiced}</strong>
            </span>
            <span>
              <small>提交</small>
              <strong>{matchingTotals.attempts}</strong>
            </span>
            <span className="passed">
              <small>正確</small>
              <strong>{matchingTotals.passed}</strong>
            </span>
            <span className="failed">
              <small>錯誤</small>
              <strong>{matchingTotals.failed}</strong>
            </span>
            <span className="memory">
              <small>FSRS 預估</small>
              <strong>{matchingAverageMemory}%</strong>
            </span>
          </div>
          {groups.length === 0 && (
            <div className="problem-library-empty">
              找不到符合目前搜尋與篩選條件的題目
            </div>
          )}
          {groups.map((group) => {
            const categoryOpen =
              deferredFiltersActive || openCategory === group.key;
            const current =
              !group.favorites &&
              !group.solvedGroup &&
              group.category === currentCategory;
            return (
              <section className="problem-library-group" key={group.key}>
                <button
                  className={`problem-library-category ${
                    current ? "current" : ""
                  } ${group.favorites ? "favorites" : ""} ${
                    group.solvedGroup ? "solved" : ""
                  }`}
                  onClick={() => {
                    if (deferredFiltersActive) return;
                    setOpenCategory((previous) =>
                      previous === group.key ? "" : group.key
                    );
                  }}
                  aria-expanded={categoryOpen}
                  aria-current={current ? "true" : undefined}
                >
                  <span>
                    <strong>{group.category}</strong>
                    {current && <b>目前</b>}
                    <em>
                      {group.problems.length} 題 · 練習 {group.attempts} 次
                      {group.starred > 0 ? ` · ★ ${group.starred}` : ""}
                    </em>
                  </span>
                  <ChevronDown
                    size={14}
                    className={categoryOpen ? "rotated" : ""}
                  />
                </button>

                {categoryOpen && (
                  <div className="problem-library-list">
                    {group.problems.map((problem) => {
                      const record = records[problem.id];
                      const attempts = record?.attempts ?? 0;
                      const passed = record?.passed ?? 0;
                      const failed = record?.failed ?? 0;
                      const solved = problemLibraryRank(record) === 0;
                      const attempting =
                        !solved && record?.status === "learning";
                      const starred = Boolean(record?.starred);
                      const memory = Math.round(
                        retrievability(
                          record?.fsrs,
                          reviewTime
                        ) * 100
                      );
                      const familiarity = familiarityLabel(
                        record?.fsrs,
                        reviewTime
                      );

                      return (
                        <ProblemRow
                          key={problem.id}
                          id={problem.id}
                          identity={problem.identity}
                          title={problem.title}
                          difficulty={problem.difficulty}
                          isCurrent={problem.id === currentId}
                          disabled={
                            selectionLocked && problem.id !== currentId
                          }
                          starred={starred}
                          solved={solved}
                          attempting={attempting}
                          attempts={attempts}
                          passed={passed}
                          failed={failed}
                          memoryPassed={record?.memoryPassed ?? 0}
                          bestLabel={elapsedLabel(record?.bestMs)}
                          memory={memory}
                          familiarity={familiarity}
                          rowRef={
                            !group.favorites &&
                            !group.solvedGroup &&
                            problem.id === currentId
                              ? currentProblemRef
                              : undefined
                          }
                          onSelect={onSelect}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default memo(ProblemLibrary);
