"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef
} from "react";

import {
  answerLineForCompletion,
  answerScrollPaddingColumns,
  answerScrollPaddingLines
} from "@/lib/answerReveal";
import {
  formatPythonSource,
  type PythonFormatResult
} from "@/lib/pythonFormatter";
import pythonCompletions from "@/lib/python-completions.json";

type PythonCompletionDefinition = {
  label: string;
  insertText: string;
  detail: string;
  kind: "function" | "method" | "module" | "constant" | "type";
};

const PYTHON_LIBRARY_COMPLETIONS =
  pythonCompletions as PythonCompletionDefinition[];

const PYTHON_API = [
  "isalnum()",
  "isalpha()",
  "isdigit()",
  "islower()",
  "isupper()",
  "lower()",
  "upper()",
  "strip()",
  "split()",
  "join()",
  "append()",
  "extend()",
  "pop()",
  "sort()",
  "items()",
  "keys()",
  "values()",
  "get()",
  "add()",
  "remove()"
];

const PYTHON_KEYWORDS = [
  "False",
  "None",
  "True",
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
  "match",
  "case"
];

const PYTHON_BUILTINS = [
  "abs",
  "all",
  "any",
  "bin",
  "bool",
  "breakpoint",
  "bytearray",
  "bytes",
  "callable",
  "chr",
  "classmethod",
  "compile",
  "complex",
  "delattr",
  "dict",
  "dir",
  "divmod",
  "enumerate",
  "eval",
  "exec",
  "filter",
  "float",
  "format",
  "frozenset",
  "getattr",
  "globals",
  "hasattr",
  "hash",
  "help",
  "hex",
  "id",
  "input",
  "int",
  "isinstance",
  "issubclass",
  "iter",
  "len",
  "list",
  "locals",
  "map",
  "max",
  "memoryview",
  "min",
  "next",
  "object",
  "oct",
  "open",
  "ord",
  "pow",
  "print",
  "property",
  "range",
  "repr",
  "reversed",
  "round",
  "set",
  "setattr",
  "slice",
  "sorted",
  "staticmethod",
  "str",
  "sum",
  "super",
  "tuple",
  "type",
  "vars",
  "zip",
  "__import__"
];

const PYTHON_SNIPPETS = [
  ["for", "for ${1:item} in ${2:items}:\\n    ${0:pass}"],
  ["while", "while ${1:condition}:\\n    ${0:pass}"],
  ["if", "if ${1:condition}:\\n    ${0:pass}"],
  ["enumerate", "for ${1:index}, ${2:value} in enumerate(${3:items}):\\n    ${0:pass}"],
  ["range", "for ${1:index} in range(${2:n}):\\n    ${0:pass}"]
] as const;

const PYTHON_RESERVED_WORDS = new Set([
  ...PYTHON_KEYWORDS,
  ...PYTHON_BUILTINS
]);

interface CodeEditorProps {
  initialValue: string;
  answer: string;
  showAnswerOverlay: boolean;
  comparisonMode?: boolean;
  answerBrightness: number;
  overlaySyncToken?: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onEditTelemetry?: (delta: {
    insertedChars: number;
    deletedChars: number;
    editOperations: number;
  }) => void;
  onHintUsed?: () => void;
  onFormatStart?: () => void;
  onFormatResult?: (result: PythonFormatResult) => void;
}

type MonacoEditor = Parameters<OnMount>[0];

export interface CodeEditorHandle {
  formatDocument: () => Promise<PythonFormatResult>;
  focusErrorLine: (lineNumber: number) => void;
}

const EDITOR_GEOMETRY = {
  automaticLayout: true,
  fontFamily:
    '"JetBrains Mono", "SFMono-Regular", Menlo, Monaco, monospace',
  fontSize: 15,
  lineHeight: 23,
  minimap: { enabled: false },
  padding: { top: 16, bottom: 22 },
  scrollBeyondLastLine: false,
  tabSize: 4,
  insertSpaces: true,
  stickyScroll: { enabled: false }
} as const;

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
function CodeEditor(
  {
    initialValue,
    answer,
    showAnswerOverlay,
    comparisonMode = false,
    answerBrightness,
    overlaySyncToken = "",
    readOnly = false,
    onChange,
    onEditTelemetry,
    onHintUsed,
    onFormatStart,
    onFormatResult
  },
  ref
) {
  const answerLayerVisible = showAnswerOverlay || comparisonMode;
  const editTelemetryRef = useRef(onEditTelemetry);
  const hintUsedRef = useRef(onHintUsed);
  const formatStartRef = useRef(onFormatStart);
  const formatResultRef = useRef(onFormatResult);
  const answerRef = useRef(answer);
  const showAnswerOverlayRef = useRef(answerLayerVisible);
  const comparisonModeRef = useRef(comparisonMode);
  const mainEditorRef = useRef<MonacoEditor | null>(null);
  const ghostEditorRef = useRef<MonacoEditor | null>(null);
  const syncingScrollRef = useRef(false);
  const syncGhostRef = useRef<() => void>(() => {});
  const syncScrollRangeRef = useRef<() => void>(() => {});
  const focusErrorLineRef = useRef<(lineNumber: number) => void>(
    () => {}
  );
  const formatEditInProgressRef = useRef(false);
  const activeFormatRef = useRef<Promise<PythonFormatResult> | null>(
    null
  );
  const formatDocumentRef = useRef<() => Promise<PythonFormatResult>>(
    async () => ({
      status: "error",
      code: "",
      message: "格式化失敗：編輯器尚未載入完成"
    })
  );

  useEffect(() => {
    editTelemetryRef.current = onEditTelemetry;
    hintUsedRef.current = onHintUsed;
    formatStartRef.current = onFormatStart;
    formatResultRef.current = onFormatResult;
  }, [onEditTelemetry, onFormatResult, onFormatStart, onHintUsed]);

  useImperativeHandle(
    ref,
    () => ({
      formatDocument: () => formatDocumentRef.current(),
      focusErrorLine: (lineNumber) =>
        focusErrorLineRef.current(lineNumber)
    }),
    []
  );

  useEffect(() => {
    answerRef.current = answer;
    showAnswerOverlayRef.current = answerLayerVisible;
    comparisonModeRef.current = comparisonMode;
  }, [answer, answerLayerVisible, comparisonMode]);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      mainEditorRef.current?.layout();
      ghostEditorRef.current?.layout();
      syncScrollRangeRef.current();
      syncGhostRef.current();
      // Monaco 會在 React effect 之後才套用 ghost model 的新內容。
      // 多等一個 frame，錯誤結果列出現或提示比例改變後仍能重新對齊。
      secondFrame = requestAnimationFrame(() => {
        mainEditorRef.current?.layout();
        ghostEditorRef.current?.layout();
        syncScrollRangeRef.current();
        syncGhostRef.current();
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [answer, answerLayerVisible, comparisonMode, overlaySyncToken]);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    mainEditorRef.current = editor;
    const errorLineDecorations =
      editor.createDecorationsCollection();
    const clearErrorLine = () => errorLineDecorations.clear();
    focusErrorLineRef.current = (requestedLineNumber) => {
      const currentModel = editor.getModel();
      if (!currentModel) return;

      const lineNumber = Math.min(
        Math.max(1, Math.trunc(requestedLineNumber)),
        currentModel.getLineCount()
      );
      errorLineDecorations.set([
        {
          range: new monaco.Range(
            lineNumber,
            1,
            lineNumber,
            currentModel.getLineMaxColumn(lineNumber)
          ),
          options: {
            isWholeLine: true,
            className: "recode-error-line",
            linesDecorationsClassName: "recode-error-line-gutter"
          }
        }
      ]);
      editor.setPosition({
        lineNumber,
        column: Math.max(
          1,
          currentModel.getLineFirstNonWhitespaceColumn(lineNumber)
        )
      });
      editor.revealLineInCenter(
        lineNumber,
        monaco.editor.ScrollType.Smooth
      );
      editor.focus();
    };
    monaco.editor.defineTheme("recode-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#00000000",
        "editorGutter.background": "#181818",
        "editorLineNumber.foreground": "#6E7681",
        "editorLineNumber.activeForeground": "#C6C6C6",
        "editor.selectionBackground": "#264F78",
        "editor.inactiveSelectionBackground": "#3A3D41",
        "editor.lineHighlightBackground": "#FFFFFF08"
      }
    });
    monaco.editor.setTheme("recode-dark");

    const syncAnswerLayer = () => {
      const ghostEditor = ghostEditorRef.current;
      if (!ghostEditor || syncingScrollRef.current) return;
      syncingScrollRef.current = true;
      try {
        ghostEditor.setScrollPosition({
          scrollLeft: editor.getScrollLeft(),
          scrollTop: editor.getScrollTop()
        });
      } finally {
        syncingScrollRef.current = false;
      }
    };
    syncGhostRef.current = syncAnswerLayer;
    let currentMainScrollPadding = -1;
    let currentGhostScrollPadding = -1;
    let currentMainVerticalPadding = -1;
    let currentGhostVerticalPadding = -1;
    let answerViewZoneId: string | null = null;
    let ghostViewZoneId: string | null = null;
    let lastGhostEditor: MonacoEditor | null = null;
    const syncAnswerScrollRange = () => {
      const currentModel = editor.getModel();
      if (!currentModel) return;
      const currentCode = currentModel.getValue();
      const currentAnswer = answerRef.current;

      const mainScrollPadding = showAnswerOverlayRef.current
        ? answerScrollPaddingColumns(
            currentAnswer,
            currentCode
          )
        : 5;
      if (mainScrollPadding !== currentMainScrollPadding) {
        currentMainScrollPadding = mainScrollPadding;
        editor.updateOptions({
          scrollBeyondLastColumn: mainScrollPadding
        });
      }

      const mainExtraLines = showAnswerOverlayRef.current
        ? answerScrollPaddingLines(
            currentAnswer,
            currentCode
          )
        : 0;
      if (mainExtraLines !== currentMainVerticalPadding) {
        currentMainVerticalPadding = mainExtraLines;
        editor.changeViewZones((accessor) => {
          if (answerViewZoneId) {
            accessor.removeZone(answerViewZoneId);
            answerViewZoneId = null;
          }
          if (mainExtraLines > 0) {
            answerViewZoneId = accessor.addZone({
              afterLineNumber: currentModel.getLineCount(),
              heightInLines: mainExtraLines,
              domNode: document.createElement("div")
            });
          }
        });
      }

      const ghostEditor = ghostEditorRef.current;
      const ghostModel = ghostEditor?.getModel();
      if (!ghostEditor || !ghostModel) return;
      if (lastGhostEditor !== ghostEditor) {
        lastGhostEditor = ghostEditor;
        currentGhostScrollPadding = -1;
        currentGhostVerticalPadding = -1;
        ghostViewZoneId = null;
      }

      // 錯誤程式可能比答案更長。兩層都必須擁有相同程度的額外
      // 捲動空間，否則其中一層會先碰到底而產生可見錯位。
      const ghostScrollPadding = showAnswerOverlayRef.current
        ? answerScrollPaddingColumns(currentCode, currentAnswer)
        : 5;
      if (ghostScrollPadding !== currentGhostScrollPadding) {
        currentGhostScrollPadding = ghostScrollPadding;
        ghostEditor.updateOptions({
          scrollBeyondLastColumn: ghostScrollPadding
        });
      }

      const ghostExtraLines = showAnswerOverlayRef.current
        ? answerScrollPaddingLines(currentCode, currentAnswer)
        : 0;
      if (ghostExtraLines !== currentGhostVerticalPadding) {
        currentGhostVerticalPadding = ghostExtraLines;
        ghostEditor.changeViewZones((accessor) => {
          if (ghostViewZoneId) {
            accessor.removeZone(ghostViewZoneId);
            ghostViewZoneId = null;
          }
          if (ghostExtraLines > 0) {
            ghostViewZoneId = accessor.addZone({
              afterLineNumber: ghostModel.getLineCount(),
              heightInLines: ghostExtraLines,
              domNode: document.createElement("div")
            });
          }
        });
      }
    };
    syncScrollRangeRef.current = syncAnswerScrollRange;
    const scrollDisposable = editor.onDidScrollChange(syncAnswerLayer);
    const layoutDisposable = editor.onDidLayoutChange(() => {
      ghostEditorRef.current?.layout();
      syncAnswerLayer();
    });
    requestAnimationFrame(() => {
      syncAnswerScrollRange();
      syncAnswerLayer();
    });

    const model = editor.getModel();
    if (model) {
      const lines = model.getLinesContent();
      const emptyBodyIndex = lines.findIndex(
        (line, index) =>
          index > 0 &&
          /^\s+$/.test(line) &&
          lines[index - 1].trimEnd().endsWith(":")
      );
      if (emptyBodyIndex >= 0) {
        editor.setPosition({
          lineNumber: emptyBodyIndex + 1,
          column: lines[emptyBodyIndex].length + 1
        });
      }
    }
    editor.focus();
    const runFormat = async (): Promise<PythonFormatResult> => {
      const currentModel = editor.getModel();
      if (!currentModel) {
        const result: PythonFormatResult = {
          status: "error",
          code: "",
          message: "格式化失敗：找不到目前文件"
        };
        formatResultRef.current?.(result);
        return result;
      }

      const source = currentModel.getValue();
      formatStartRef.current?.();
      const result = await formatPythonSource(source);
      if (result.status !== "formatted") {
        formatResultRef.current?.(result);
        return result;
      }

      const selections = editor.getSelections();
      const scrollPosition = {
        scrollLeft: editor.getScrollLeft(),
        scrollTop: editor.getScrollTop()
      };
      formatEditInProgressRef.current = true;
      editor.pushUndoStop();
      editor.executeEdits(
        "recode-python-format",
        [
          {
            range: currentModel.getFullModelRange(),
            text: result.code
          }
        ],
        selections ?? undefined
      );
      editor.pushUndoStop();
      formatEditInProgressRef.current = false;
      editor.setScrollPosition(scrollPosition);
      editor.focus();
      formatResultRef.current?.(result);
      return result;
    };
    const formatCurrentDocument = (): Promise<PythonFormatResult> => {
      if (activeFormatRef.current) return activeFormatRef.current;
      const pending = runFormat()
        .catch((error) => {
          const result: PythonFormatResult = {
            status: "error",
            code: editor.getValue(),
            message:
              error instanceof Error
                ? `格式化失敗：${error.message}`
                : "格式化失敗：編輯器無法套用排版"
          };
          formatEditInProgressRef.current = false;
          formatResultRef.current?.(result);
          return result;
        })
        .finally(() => {
          if (activeFormatRef.current === pending) {
            activeFormatRef.current = null;
          }
        });
      activeFormatRef.current = pending;
      return pending;
    };
    formatDocumentRef.current = formatCurrentDocument;
    editor.addCommand(
      monaco.KeyMod.Shift |
        monaco.KeyMod.Alt |
        monaco.KeyCode.KeyF,
      () => {
        void formatCurrentDocument();
      }
    );

    const answerLineDisposable = editor.onKeyDown((event) => {
      const keyboardEvent = event.browserEvent;
      if (
        event.keyCode !== monaco.KeyCode.Enter ||
        !keyboardEvent.altKey ||
        keyboardEvent.ctrlKey ||
        keyboardEvent.metaKey ||
        keyboardEvent.shiftKey ||
        !showAnswerOverlayRef.current
      ) {
        return;
      }

      const position = editor.getPosition();
      const currentModel = editor.getModel();
      if (!position || !currentModel) return;
      const completedLine = answerLineForCompletion(
        answerRef.current,
        position.lineNumber
      );
      if (completedLine === undefined) return;

      event.preventDefault();
      event.stopPropagation();
      hintUsedRef.current?.();
      editor.executeEdits("recode-answer-line", [
        {
          range: new monaco.Range(
            position.lineNumber,
            1,
            position.lineNumber,
            currentModel.getLineMaxColumn(position.lineNumber)
          ),
          text: completedLine
        }
      ]);
      editor.setPosition({
        lineNumber: position.lineNumber,
        column: completedLine.length + 1
      });
      editor.focus();
    });
    let outerScrollFrame = 0;
    let outerScrollSecondFrame = 0;
    const enterScrollDisposable = editor.onKeyDown((event) => {
      const keyboardEvent = event.browserEvent;
      if (
        event.keyCode !== monaco.KeyCode.Enter ||
        keyboardEvent.altKey ||
        keyboardEvent.ctrlKey ||
        keyboardEvent.metaKey ||
        keyboardEvent.shiftKey ||
        !comparisonModeRef.current
      ) {
        return;
      }

      const codingPanel = editor
        .getDomNode()
        ?.closest<HTMLElement>(".coding-panel");
      if (!codingPanel) return;

      const panelTop = codingPanel.scrollTop;
      const panelLeft = codingPanel.scrollLeft;
      const pageX = window.scrollX;
      const pageY = window.scrollY;
      const restoreOuterScroll = () => {
        codingPanel.scrollTop = panelTop;
        codingPanel.scrollLeft = panelLeft;
        if (window.scrollX !== pageX || window.scrollY !== pageY) {
          window.scrollTo(pageX, pageY);
        }
      };

      cancelAnimationFrame(outerScrollFrame);
      cancelAnimationFrame(outerScrollSecondFrame);
      outerScrollFrame = requestAnimationFrame(() => {
        restoreOuterScroll();
        // Safari 有時會在 Monaco 完成游標重新定位後才捲動祖先容器，
        // 因此下一個 frame 再固定一次。編輯器自己的 scrollTop 不受影響。
        outerScrollSecondFrame = requestAnimationFrame(restoreOuterScroll);
      });
    });
    const telemetryDisposable = editor.onDidChangeModelContent(
      (event) => {
        clearErrorLine();
        syncAnswerScrollRange();
        requestAnimationFrame(syncAnswerLayer);
        if (formatEditInProgressRef.current) return;
        const insertedChars = event.changes.reduce(
          (total, change) => total + change.text.length,
          0
        );
        const deletedChars = event.changes.reduce(
          (total, change) => total + change.rangeLength,
          0
        );
        editTelemetryRef.current?.({
          insertedChars,
          deletedChars,
          editOperations: event.changes.length
        });
      }
    );

    const completionDisposable =
      monaco.languages.registerCompletionItemProvider("python", {
        triggerCharacters: [".", "_"],
        provideCompletionItems(model, position) {
          const text = model.getValue();
          const words =
            text.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
          const currentWords = Array.from(
            new Set([...words].reverse())
          ).filter((word) => !PYTHON_RESERVED_WORDS.has(word));
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: model.getWordUntilPosition(position).startColumn,
            endColumn: position.column
          };
          const currentSuggestions = currentWords.map((word, index) => ({
            label: word,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: word,
            sortText: `0-${String(index).padStart(4, "0")}`,
            detail: "目前程式碼出現過",
            range
          }));
          const completionKinds = {
            function: monaco.languages.CompletionItemKind.Function,
            method: monaco.languages.CompletionItemKind.Method,
            module: monaco.languages.CompletionItemKind.Module,
            constant: monaco.languages.CompletionItemKind.Constant,
            type: monaco.languages.CompletionItemKind.Class
          };
          const librarySuggestions = PYTHON_LIBRARY_COMPLETIONS.map(
            (completion, index) => ({
              label: completion.label,
              kind: completionKinds[completion.kind],
              insertText: completion.insertText,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              sortText: `${
                completion.kind === "method" ? "4a" : "1"
              }-${String(index).padStart(4, "0")}`,
              detail: completion.detail,
              documentation:
                "RECODE 測試環境已預載；複製到獨立 Python 檔時，請加入對應 import。",
              range
            })
          );
          const apiSuggestions = PYTHON_API.map((api, index) => ({
            label: api,
            kind: monaco.languages.CompletionItemKind.Method,
            insertText: api,
            sortText: `4-${String(index).padStart(4, "0")}`,
            detail: "Python 常用 API",
            range
          }));
          const keywordSuggestions = PYTHON_KEYWORDS.map((keyword, index) => ({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword,
            sortText: `2-${String(index).padStart(4, "0")}`,
            detail: "Python 3 keyword",
            range
          }));
          const builtinSuggestions = PYTHON_BUILTINS.map((builtin, index) => ({
            label: builtin,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: builtin,
            sortText: `3-${String(index).padStart(4, "0")}`,
            detail: "Python 3 built-in",
            range
          }));
          const snippets = PYTHON_SNIPPETS.map(([label, insertText], index) => ({
            label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText,
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            sortText: `5-${String(index).padStart(4, "0")}`,
            detail: "Python 主幹",
            range
          }));
          return {
            suggestions: [
              ...currentSuggestions,
              ...librarySuggestions,
              ...keywordSuggestions,
              ...builtinSuggestions,
              ...apiSuggestions,
              ...snippets
            ]
          };
        }
      });

    editor.onDidDispose(() => {
      if (mainEditorRef.current === editor) {
        mainEditorRef.current = null;
      }
      syncGhostRef.current = () => {};
      syncScrollRangeRef.current = () => {};
      focusErrorLineRef.current = () => {};
      clearErrorLine();
      formatDocumentRef.current = async () => ({
        status: "error",
        code: "",
        message: "格式化失敗：編輯器尚未載入完成"
      });
      scrollDisposable.dispose();
      layoutDisposable.dispose();
      answerLineDisposable.dispose();
      enterScrollDisposable.dispose();
      cancelAnimationFrame(outerScrollFrame);
      cancelAnimationFrame(outerScrollSecondFrame);
      telemetryDisposable.dispose();
      completionDisposable.dispose();
    });
  }, []);

  const handleGhostMount: OnMount = useCallback((editor) => {
    ghostEditorRef.current = editor;
    editor
      .getDomNode()
      ?.querySelector("textarea")
      ?.setAttribute("tabindex", "-1");
    requestAnimationFrame(() => {
      syncScrollRangeRef.current();
      syncGhostRef.current();
    });
    const scrollDisposable = editor.onDidScrollChange(() => {
      const mainEditor = mainEditorRef.current;
      if (!mainEditor || syncingScrollRef.current) return;
      syncingScrollRef.current = true;
      try {
        mainEditor.setScrollPosition({
          scrollLeft: editor.getScrollLeft(),
          scrollTop: editor.getScrollTop()
        });
      } finally {
        syncingScrollRef.current = false;
      }
    });
    editor.onDidDispose(() => {
      if (ghostEditorRef.current === editor) {
        ghostEditorRef.current = null;
      }
      scrollDisposable.dispose();
    });
  }, []);

  return (
    <div
      className={`code-editor-wrap ${
        comparisonMode ? "is-comparing" : ""
      }`}
    >
      {answerLayerVisible && answer ? (
        <div
          className="code-answer-layer"
          style={{
            opacity: comparisonMode ? 1 : answerBrightness / 100
          }}
          aria-hidden={comparisonMode ? undefined : true}
          aria-label={comparisonMode ? "AC 答案" : undefined}
        >
          <Editor
            height="100%"
            language="python"
            theme="recode-dark"
            value={answer}
            onMount={handleGhostMount}
            options={{
              ...EDITOR_GEOMETRY,
              readOnly: true,
              domReadOnly: true,
              renderLineHighlight: "none",
              renderValidationDecorations: "off",
              occurrencesHighlight: "off",
              selectionHighlight: false,
              foldingHighlight: false,
              links: false,
              contextmenu: false,
              cursorBlinking: "solid",
              scrollbar: {
                alwaysConsumeMouseWheel: false,
                verticalScrollbarSize: 10,
                horizontalScrollbarSize: 10
              }
            }}
          />
        </div>
      ) : null}
      <div className="code-editor-main">
        <Editor
          height="100%"
          language="python"
          theme="recode-dark"
          defaultValue={initialValue}
          onChange={(next) => onChange(next ?? "")}
          onMount={handleMount}
          options={{
            ...EDITOR_GEOMETRY,
            readOnly,
            scrollbar: {
              alwaysConsumeMouseWheel: false,
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10
            },
            smoothScrolling: true,
            cursorSmoothCaretAnimation: "on",
            formatOnPaste: false,
            wordBasedSuggestions: "currentDocument",
            suggest: {
              showWords: true,
              preview: true,
              snippetsPreventQuickSuggestions: false,
              showStatusBar: true
            },
            quickSuggestions: {
              other: true,
              comments: false,
              strings: true
            },
            suggestOnTriggerCharacters: true,
            quickSuggestionsDelay: 80,
            inlineSuggest: { enabled: false },
            bracketPairColorization: { enabled: true },
            autoClosingBrackets: "always",
            autoClosingQuotes: "always",
            guides: { bracketPairs: true, indentation: true }
          }}
        />
      </div>
    </div>
  );
});

export default memo(CodeEditor);
