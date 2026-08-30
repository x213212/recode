export const MARKDOWN_CALLOUT_KINDS = [
  "NOTE",
  "QUESTION",
  "IMPORTANT",
  "TIP",
  "WARNING",
  "CAUTION"
] as const;

export type MarkdownCalloutKind =
  (typeof MARKDOWN_CALLOUT_KINDS)[number];

const CALLOUT_KIND_PATTERN =
  "(NOTE|QUESTION|IMPORTANT|TIP|WARNING|CAUTION)";

const SHORTHAND_CALLOUT = new RegExp(
  `^(\\s*)\\[!${CALLOUT_KIND_PATTERN}(?:\\]\\s*|\\s+)(.*)$`,
  "i"
);

export const CALLOUT_MARKER = new RegExp(
  `^\\s*\\[!${CALLOUT_KIND_PATTERN}\\](?:[ \\t]*\\r?\\n[ \\t]*|[ \\t]+)?`,
  "i"
);

/**
 * GitHub 的警示語法原本必須寫成 blockquote：
 *
 * > [!NOTE]
 * > 內容
 *
 * 個人筆記輸入速度優先，因此也接受單行的 `[!NOTE] 內容`，
 * 並在送進 Markdown parser 前轉成標準 blockquote。
 */
export function normalizeMarkdownCallouts(source: string): string {
  let fenceCharacter = "";
  let fenceLength = 0;

  return source
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      const fence = trimmed.match(/^(`{3,}|~{3,})/);

      if (fenceCharacter) {
        if (
          fence &&
          fence[1][0] === fenceCharacter &&
          fence[1].length >= fenceLength
        ) {
          fenceCharacter = "";
          fenceLength = 0;
        }
        return line;
      }

      if (fence) {
        fenceCharacter = fence[1][0];
        fenceLength = fence[1].length;
        return line;
      }

      // 已經是標準 blockquote，交給 Markdown parser 原樣處理。
      if (/^\s*>/.test(line)) return line;

      const match = line.match(SHORTHAND_CALLOUT);
      if (!match) return line;

      const [, indentation, rawKind, body] = match;
      // 四格縮排本身代表 Markdown code block，不應改寫。
      if (indentation.includes("\t") || indentation.length >= 4) {
        return line;
      }

      const kind = rawKind.toUpperCase() as MarkdownCalloutKind;
      const marker = `${indentation}> [!${kind}]`;
      return body.trim()
        ? `${marker}\n${indentation}> ${body.trim()}`
        : marker;
    })
    .join("\n");
}
