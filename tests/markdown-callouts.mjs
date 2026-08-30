import assert from "node:assert/strict";

import {
  CALLOUT_MARKER,
  normalizeMarkdownCallouts
} from "../lib/markdownCallouts.ts";

assert.equal(
  normalizeMarkdownCallouts("[!NOTE] 已知條件"),
  "> [!NOTE]\n> 已知條件"
);

assert.equal(
  normalizeMarkdownCallouts("[!QUESTION] 目前缺口"),
  "> [!QUESTION]\n> 目前缺口"
);

assert.equal(
  normalizeMarkdownCallouts("[!IMPORTANT  先取得兩棵結果"),
  "> [!IMPORTANT]\n> 先取得兩棵結果"
);

assert.equal(
  normalizeMarkdownCallouts("> [!TIP]\n> 保留標準語法"),
  "> [!TIP]\n> 保留標準語法"
);

assert.equal(
  normalizeMarkdownCallouts(
    "```text\n[!WARNING] 這是程式碼內容\n```"
  ),
  "```text\n[!WARNING] 這是程式碼內容\n```"
);

assert.equal(
  normalizeMarkdownCallouts("    [!NOTE] 縮排程式碼"),
  "    [!NOTE] 縮排程式碼"
);

const marker = "[!CAUTION]\n需要留意".match(CALLOUT_MARKER);
assert.equal(marker?.[1], "CAUTION");
assert.equal(
  "[!CAUTION]\n需要留意".slice(marker?.[0].length),
  "需要留意"
);

console.log(
  "Markdown 提示框測試通過：標準語法、單行縮寫、自訂 QUESTION、缺少右括號與 code fence。"
);
