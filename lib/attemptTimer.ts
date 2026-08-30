import type { AttemptTimerState } from "@/lib/types";

export function emptyAttemptTimer(): AttemptTimerState {
  return {
    started: false,
    elapsedMs: 0
  };
}

export function normalizeAttemptTimer(
  value: AttemptTimerState | undefined
): AttemptTimerState {
  if (!value || typeof value !== "object") return emptyAttemptTimer();

  return {
    started: Boolean(value.started),
    elapsedMs: Math.max(0, Number(value.elapsedMs) || 0),
    ...(Number.isFinite(value.runningSince)
      ? { runningSince: Number(value.runningSince) }
      : {})
  };
}

export function beginOrResumeAttempt(
  timer: AttemptTimerState,
  now: number
): AttemptTimerState {
  if (timer.runningSince !== undefined) return timer;
  return {
    ...timer,
    started: true,
    runningSince: now
  };
}

export function pauseAttempt(
  timer: AttemptTimerState,
  now: number
): AttemptTimerState {
  if (timer.runningSince === undefined) return timer;
  return {
    started: timer.started,
    elapsedMs:
      timer.elapsedMs + Math.max(0, now - timer.runningSince)
  };
}

export function attemptElapsedMs(
  timer: AttemptTimerState,
  now: number
): number {
  if (timer.runningSince === undefined) return timer.elapsedMs;
  return (
    timer.elapsedMs + Math.max(0, now - timer.runningSince)
  );
}
