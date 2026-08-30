import assert from "node:assert/strict";

import { format } from "@wasm-fmt/ruff_fmt/node";
import { shouldFormatBeforeSubmit } from "../lib/pythonFormatPolicy.ts";

const source = `class Solution:
 def solve( self,nums ):
  answer=[]
  for value in nums:
   answer.append( value+1 )
  return answer`;

const formatted = format(source, "solution.py", {
  indent_style: "space",
  indent_width: 4,
  line_width: 88,
  line_ending: "lf",
  quote_style: "double",
  magic_trailing_comma: "respect"
});

assert.equal(
  formatted,
  `class Solution:
    def solve(self, nums):
        answer = []
        for value in nums:
            answer.append(value + 1)
        return answer
`
);
assert.equal(format(formatted, "solution.py"), formatted);
assert.throws(
  () => format("def broken(:\\n    pass", "solution.py"),
  /parse|syntax|expected|unexpected/i,
  "語法不完整時 formatter 必須失敗，不可產生看似成功的程式碼"
);
assert.equal(shouldFormatBeforeSubmit("guided", true), true);
assert.equal(shouldFormatBeforeSubmit("free", true), true);
assert.equal(shouldFormatBeforeSubmit("explore", true), true);
assert.equal(shouldFormatBeforeSubmit("interview", true), true);
assert.equal(shouldFormatBeforeSubmit("free", false), false);
assert.equal(
  shouldFormatBeforeSubmit("speed", true),
  false,
  "Speed Mode 必須維持手動格式化"
);
assert.equal(
  shouldFormatBeforeSubmit("repeat", true),
  false,
  "Repeat Mode 必須維持手動格式化"
);

console.log("Python formatter 測試通過：Ruff 排版、冪等與語法失敗保護。");
