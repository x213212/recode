export type PythonFormatResult =
  | {
      status: "formatted" | "unchanged";
      code: string;
      message: string;
    }
  | {
      status: "error";
      code: string;
      message: string;
    };

type RuffWebModule = typeof import("@wasm-fmt/ruff_fmt/web");

let formatterModulePromise: Promise<RuffWebModule> | null = null;

async function loadFormatter(): Promise<RuffWebModule> {
  if (!formatterModulePromise) {
    formatterModulePromise = import("@wasm-fmt/ruff_fmt/web")
      .then(async (module) => {
        await module.default();
        return module;
      })
      .catch((error) => {
        formatterModulePromise = null;
        throw error;
      });
  }
  return formatterModulePromise;
}

function formatterErrorMessage(error: unknown): string {
  const detail =
    error instanceof Error ? error.message : String(error ?? "");
  if (/parse|syntax|unexpected|expected/i.test(detail)) {
    return "格式化失敗：Python 語法尚未完整，請先修正語法錯誤";
  }
  return detail
    ? `格式化失敗：${detail}`
    : "格式化失敗：無法載入 Python formatter";
}

export async function formatPythonSource(
  source: string
): Promise<PythonFormatResult> {
  try {
    const formatter = await loadFormatter();
    const code = formatter.format(source, "solution.py", {
      indent_style: "space",
      indent_width: 4,
      line_width: 88,
      line_ending: "lf",
      quote_style: "double",
      magic_trailing_comma: "respect"
    });
    return code === source
      ? {
          status: "unchanged",
          code,
          message: "程式碼格式已經正確"
        }
      : {
          status: "formatted",
          code,
          message: "已使用 Ruff 格式化；Command/Ctrl+Z 可復原"
        };
  } catch (error) {
    return {
      status: "error",
      code: source,
      message: formatterErrorMessage(error)
    };
  }
}
