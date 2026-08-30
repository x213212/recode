"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TestCase, TestResult } from "@/lib/types";

export type RunnerStatus =
  | "idle"
  | "runtime-loading"
  | "executing"
  | "finished"
  | "error"
  | "timeout";

interface PendingRun {
  id: number;
  resolve: (results: TestResult[]) => void;
  runtimeTimeout?: ReturnType<typeof setTimeout>;
  executionTimeout?: ReturnType<typeof setTimeout>;
}

const RUNTIME_LOAD_TIMEOUT_MS = 30_000;
const EXECUTION_TIMEOUT_MS = 5_000;

export function usePythonRunner() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<PendingRun | null>(null);
  const nextIdRef = useRef(1);
  const [status, setStatus] = useState<RunnerStatus>("idle");

  const destroyWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const clearPendingTimeouts = useCallback((pending: PendingRun) => {
    if (pending.runtimeTimeout) {
      clearTimeout(pending.runtimeTimeout);
    }
    if (pending.executionTimeout) {
      clearTimeout(pending.executionTimeout);
    }
  }, []);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;

    const worker = new Worker("/pyodide-worker.js");
    worker.onmessage = (event) => {
      const message = event.data;
      const pending = pendingRef.current;
      if (!pending || message.id !== pending.id) return;

      if (message.type === "runtime-loading") {
        setStatus("runtime-loading");
        return;
      }
      if (message.type === "executing") {
        if (pending.runtimeTimeout) {
          clearTimeout(pending.runtimeTimeout);
          pending.runtimeTimeout = undefined;
        }
        setStatus("executing");
        pending.executionTimeout = setTimeout(() => {
          setStatus("timeout");
          destroyWorker();
          const result: TestResult[] = [
            {
              name: "執行逾時",
              passed: false,
              errorType: "TLE",
              error: "TLE：Python 程式真正開始執行後超過 5 秒。Runtime 載入時間未計入。"
            }
          ];
          pendingRef.current = null;
          pending.resolve(result);
        }, EXECUTION_TIMEOUT_MS);
        return;
      }
      if (message.type === "result") {
        clearPendingTimeouts(pending);
        const results = message.payload?.results ?? [];
        setStatus("finished");
        pendingRef.current = null;
        pending.resolve(results);
        return;
      }
      if (message.type === "error") {
        clearPendingTimeouts(pending);
        setStatus("error");
        const result: TestResult[] = [
          {
            name: "執行器錯誤",
            passed: false,
            errorType: "Runner Error",
            error: String(message.error ?? "未知錯誤")
          }
        ];
        pendingRef.current = null;
        pending.resolve(result);
      }
    };
    worker.onerror = (event) => {
      const pending = pendingRef.current;
      if (!pending) return;
      clearPendingTimeouts(pending);
      setStatus("error");
      pendingRef.current = null;
      pending.resolve([
        {
          name: "Worker 錯誤",
          passed: false,
          errorType: "Runner Error",
          error: event.message
        }
      ]);
      destroyWorker();
    };
    workerRef.current = worker;
    return worker;
  }, [clearPendingTimeouts, destroyWorker]);

  const run = useCallback(
    (code: string, tests: TestCase[], unorderedOutput: boolean) => {
      if (pendingRef.current) {
        return Promise.resolve<TestResult[]>([
          {
            name: "執行中",
            passed: false,
            errorType: "Runner Error",
            error: "上一輪測資仍在執行。"
          }
        ]);
      }

      setStatus("runtime-loading");
      const worker = ensureWorker();
      const id = nextIdRef.current++;

      return new Promise<TestResult[]>((resolve) => {
        const pending: PendingRun = { id, resolve };
        pending.runtimeTimeout = setTimeout(() => {
          if (pendingRef.current?.id !== id) return;
          setStatus("error");
          destroyWorker();
          pendingRef.current = null;
          resolve([
            {
              name: "Runtime 載入逾時",
              passed: false,
              errorType: "Runner Error",
              error:
                "Python Runtime 在 30 秒內沒有載入完成。請檢查網路後再執行一次。"
            }
          ]);
        }, RUNTIME_LOAD_TIMEOUT_MS);
        pendingRef.current = pending;
        try {
          worker.postMessage({
            id,
            type: "run",
            code,
            tests,
            unorderedOutput
          });
        } catch (error) {
          clearPendingTimeouts(pending);
          pendingRef.current = null;
          destroyWorker();
          setStatus("error");
          resolve([
            {
              name: "Worker 啟動失敗",
              passed: false,
              errorType: "Runner Error",
              error:
                error instanceof Error
                  ? error.message
                  : "無法把程式送進 Python Worker"
            }
          ]);
        }
      });
    },
    [clearPendingTimeouts, destroyWorker, ensureWorker]
  );

  useEffect(
    () => () => {
      const pending = pendingRef.current;
      if (pending) clearPendingTimeouts(pending);
      pendingRef.current = null;
      destroyWorker();
    },
    [clearPendingTimeouts, destroyWorker]
  );

  return { run, status };
}
