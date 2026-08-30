import { isMemoryEligibleSubmission } from "./memoryEvidence.ts";
import type { SubmissionEvent } from "./types.ts";

export interface RecallCalibration {
  sampleSize: number;
  predictedRecall: number;
  observedRecall: number;
  /** 正值代表實際表現比模型預估好；負值代表模型過度樂觀。 */
  bias: number;
  brierScore: number;
  confidence: "none" | "low" | "medium" | "high";
}

function clampProbability(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * 用「送出前的 FSRS 預估」對照「這次是否真的獨立答對」。
 *
 * 只有沒有看答案、而且當時已經有 FSRS 卡片的提交才有資格進入校準。
 * 新題沒有先前記憶率，因此不能拿來判斷模型準不準。
 */
export function buildRecallCalibration(
  history: SubmissionEvent[]
): RecallCalibration {
  const eligible = history.filter(
    (event) =>
      isMemoryEligibleSubmission(event) &&
      typeof event.predictedRecall === "number" &&
      Number.isFinite(event.predictedRecall)
  );

  // 一個回想回合可能先 WA 多次、最後才 AC。校準觀察的是「這次延遲
  // 回想是否一次成功」，不是送出按鈕按了幾次；同 roundId 只能貢獻
  // 一筆，而且回合內任何真正的失敗都使 observed=0。
  const grouped = new Map<string, SubmissionEvent[]>();
  for (const event of eligible) {
    const key = event.roundId ? `round:${event.roundId}` : `event:${event.id}`;
    const events = grouped.get(key) ?? [];
    events.push(event);
    grouped.set(key, events);
  }
  const observations = [...grouped.values()].map((events) => {
    const chronological = [...events].sort(
      (left, right) =>
        Date.parse(left.submittedAt) - Date.parse(right.submittedAt)
    );
    const predicted = clampProbability(
      chronological[0]?.predictedRecall ?? 0
    );
    return {
      predicted,
      observed: events.some((event) => !event.passed) ? 0 : 1
    };
  });

  if (!observations.length) {
    return {
      sampleSize: 0,
      predictedRecall: 0,
      observedRecall: 0,
      bias: 0,
      brierScore: 0,
      confidence: "none"
    };
  }

  let predictedTotal = 0;
  let observedTotal = 0;
  let squaredErrorTotal = 0;

  for (const observation of observations) {
    const { predicted, observed } = observation;
    predictedTotal += predicted;
    observedTotal += observed;
    squaredErrorTotal += (predicted - observed) ** 2;
  }

  const sampleSize = observations.length;
  const predictedRecall = predictedTotal / sampleSize;
  const observedRecall = observedTotal / sampleSize;

  return {
    sampleSize,
    predictedRecall,
    observedRecall,
    bias: observedRecall - predictedRecall,
    brierScore: squaredErrorTotal / sampleSize,
    confidence:
      sampleSize >= 50
        ? "high"
        : sampleSize >= 20
          ? "medium"
          : sampleSize >= 8
            ? "low"
            : "none"
  };
}

/**
 * 樣本不足時不調整。累積至少 8 次延遲回想後，如果實際答對率明顯
 * 低於 FSRS 預估，最多增加 1 分困難度，避免系統繼續把間隔拉太長。
 *
 * 實際表現高於預估時不主動放寬；這套工具以避免過度自信為優先。
 */
export function recallCalibrationPressure(
  calibration: RecallCalibration
): number {
  if (calibration.sampleSize < 8 || calibration.bias >= -0.1) return 0;
  return Math.min(1, (-calibration.bias - 0.1) / 0.15);
}

export function recallCalibrationLabel(
  calibration: RecallCalibration
): string {
  if (calibration.sampleSize < 8) {
    return `待累積（${calibration.sampleSize}/8）`;
  }
  const difference = Math.round(calibration.bias * 100);
  if (difference <= -10) return `模型偏高 ${Math.abs(difference)}%`;
  if (difference >= 10) return `模型偏低 ${difference}%`;
  return "落在合理範圍";
}
