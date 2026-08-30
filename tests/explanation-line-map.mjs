import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const { explanationLineMapMarkdown } = await import(
  "../lib/explanationLineMap.ts"
);

const root = process.cwd();
const dataRoot = process.env.RECODE_SITE_DATA_OUTPUT
  ? path.resolve(process.env.RECODE_SITE_DATA_OUTPUT)
  : path.join(root, "public", "data");
const problemDir = path.join(dataRoot, "problems");
const index = JSON.parse(
  fs.readFileSync(path.join(dataRoot, "index.json"), "utf8")
);

let mapped = 0;
for (const summary of index.problems) {
  const problem = JSON.parse(
    fs.readFileSync(path.join(problemDir, `${summary.id}.json`), "utf8")
  );
  const markdown = explanationLineMapMarkdown(problem);
  assert.match(
    markdown,
    /^## 最後對回右側 AC 程式碼/m,
    `${summary.id} 沒有產生行號對照`
  );
  assert.match(markdown, /\*\*L\d+/, `${summary.id} 沒有實際行號`);
  mapped += 1;
}

const sample = JSON.parse(
  fs.readFileSync(path.join(problemDir, "lc-215.json"), "utf8")
);
const sampleMarkdown = explanationLineMapMarkdown(sample);
assert.match(sampleMarkdown, /\*\*L3｜`min_heap`\*\*/);
assert.match(sampleMarkdown, /\*\*L4｜`num`、`nums`\*\*/);
assert.match(sampleMarkdown, /\*\*L6｜`min_heap`、`k`\*\*/);
assert.match(sampleMarkdown, /\*\*L8｜`min_heap`\*\*/);

console.log(`題解行號對照測試通過：${mapped} 題皆可對回 AC 主幹。`);
