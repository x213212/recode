import assert from "node:assert/strict";

import {
  buildRecallCalibration,
  recallCalibrationLabel,
  recallCalibrationPressure
} from "../lib/memoryCalibration.ts";
import { assessAcceptedSubmission } from "../lib/review.ts";

const overconfidentHistory = Array.from(
  { length: 8 },
  (_, index) => ({
    id: `calibration-${index}`,
    problemId: `other-${index}`,
    submittedAt: new Date(
      Date.parse("2026-07-20T00:00:00.000Z") + index * 60_000
    ).toISOString(),
    passed: false,
    durationMs: 60_000,
    memoryEligible: true,
    predictedRecall: 0.9
  })
);
const calibration = buildRecallCalibration(overconfidentHistory);

assert.equal(calibration.sampleSize, 8);
assert.ok(Math.abs(calibration.predictedRecall - 0.9) < 0.000001);
assert.equal(calibration.observedRecall, 0);
assert.ok(calibration.bias < -0.8);
assert.equal(recallCalibrationPressure(calibration), 1);
assert.match(recallCalibrationLabel(calibration), /模型偏高/);

const calibratedAssessment = assessAcceptedSubmission(
  overconfidentHistory,
  "target",
  {
    durationMs: 60_000,
    difficulty: "easy"
  }
);
assert.equal(
  calibratedAssessment.rating,
  "hard",
  "模型持續高估個人記憶時，乾淨 AC 也要保守一級，避免排程越拉越遠"
);
assert.equal(calibratedAssessment.calibrationSampleSize, 8);
assert.equal(calibratedAssessment.calibrationPressure, 1);

const assisted = buildRecallCalibration([
  {
    ...overconfidentHistory[0],
    id: "assisted",
    passed: true,
    memoryEligible: false,
    predictedRecall: 0.2
  }
]);
assert.equal(
  assisted.sampleSize,
  0,
  "看答案通過不可拿來宣稱模型預估準確"
);

const noisySingleRound = buildRecallCalibration(
  Array.from({ length: 8 }, (_, index) => ({
    ...overconfidentHistory[index],
    id: `same-round-${index}`,
    roundId: "one-delayed-recall",
    passed: index === 7
  }))
);
assert.equal(
  noisySingleRound.sampleSize,
  1,
  "同一回合連續送出不可灌成八個校準樣本"
);
assert.equal(
  noisySingleRound.observedRecall,
  0,
  "回合內曾真正失敗就不是一次成功回想"
);

console.log("記憶校準測試通過：預估與真實延遲回想會形成可審計的個人偏差。");
