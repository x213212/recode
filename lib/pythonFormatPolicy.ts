import type { PracticeMode } from "./types.ts";

export function shouldFormatBeforeSubmit(
  mode: PracticeMode,
  enabled: boolean
): boolean {
  return enabled && mode !== "speed" && mode !== "repeat";
}
