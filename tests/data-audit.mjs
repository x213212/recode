import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataRoot = process.env.RECODE_SITE_DATA_OUTPUT
  ? path.resolve(process.env.RECODE_SITE_DATA_OUTPUT)
  : path.join(root, "public", "data");
const indexPath = path.join(dataRoot, "index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));

const errors = [];
if (index.total !== index.problems.length) {
  errors.push(`index.total=${index.total}，但 problems=${index.problems.length}`);
}

const ids = new Set();
for (const summary of index.problems) {
  if (ids.has(summary.id)) errors.push(`重複 id：${summary.id}`);
  ids.add(summary.id);
  if (!["easy", "medium", "hard"].includes(summary.difficulty)) {
    errors.push(`${summary.id} 缺少有效難度：${summary.difficulty}`);
  }
  if (summary.testCount < 1) {
    errors.push(`${summary.id} 沒有任何測資`);
  }
  if (!summary.runnable) {
    errors.push(`${summary.id} 無法在練習網站執行`);
  }

  const detailPath = path.join(
    dataRoot,
    "problems",
    `${summary.id}.json`
  );
  if (!fs.existsSync(detailPath)) {
    errors.push(`缺少題目檔：${summary.id}`);
    continue;
  }

  const detail = JSON.parse(fs.readFileSync(detailPath, "utf8"));
  if (detail.difficulty !== summary.difficulty) {
    errors.push(
      `${summary.id} 摘要難度 ${summary.difficulty} 與詳細檔 ${detail.difficulty} 不一致`
    );
  }
  if (detail.tests.length !== summary.testCount) {
    errors.push(
      `${summary.id} 摘要測資 ${summary.testCount} 與詳細檔 ${detail.tests.length} 不一致`
    );
  }
  for (const field of [
    "identity",
    "title",
    "category",
    "statementZh",
    "statementEn",
    "answer",
    "starter",
    "goal",
    "route",
    "derivation",
    "proof",
    "rebuild",
    "memoryLine"
  ]) {
    if (!String(detail[field] ?? "").trim()) {
      errors.push(`${summary.id} 缺少 ${field}`);
    }
  }
  if (!Array.isArray(detail.pythonTools)) {
    errors.push(`${summary.id} 缺少 pythonTools 陣列`);
  } else {
    const toolIds = new Set();
    for (const tool of detail.pythonTools) {
      if (!tool.id || !tool.name || !tool.note || !tool.example) {
        errors.push(`${summary.id} 的 Python 工具卡欄位不完整`);
      }
      if (toolIds.has(tool.id)) {
        errors.push(`${summary.id} 重複列出 Python 工具 ${tool.id}`);
      }
      toolIds.add(tool.id);
    }
  }
  if (!String(detail.overlayAnswer ?? "").trim()) {
    errors.push(`${summary.id} 缺少可顯示的透明答案底稿`);
  }
  const starterLines = String(detail.starter ?? "").split("\n");
  const overlayLines = String(detail.overlayAnswer ?? "").split("\n");
  if (starterLines.length !== overlayLines.length) {
    errors.push(
      `${summary.id} starter ${starterLines.length} 行，答案 ${overlayLines.length} 行，透明答案一定會錯位`
    );
  } else {
    starterLines.forEach((line, index) => {
      if (line.trim() && line !== overlayLines[index]) {
        errors.push(
          `${summary.id} starter 第 ${index + 1} 行沒有對齊答案同一行`
        );
      }
    });
  }
  if (!/class\s+\w+\b/.test(detail.starter)) {
    errors.push(`${summary.id} starter 缺少類別骨架`);
  }
  if (!/def\s+\w+\s*\(/.test(detail.starter)) {
    errors.push(`${summary.id} starter 缺少函式簽名`);
  }
  if (detail.runnable && detail.tests.length === 0) {
    errors.push(`${summary.id} 標記 runnable 卻沒有測資`);
  }
}

if (errors.length) {
  console.error(errors.slice(0, 50).join("\n"));
  console.error(`共 ${errors.length} 個資料錯誤`);
  process.exit(1);
}

console.log(
  `資料審計通過：${index.total} 題、${index.categories.length} 類、${index.sources.length} 份題單。`
);
