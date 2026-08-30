let pyodidePromise = null;
let runnerSourcePromise = null;

async function ensureRuntime() {
  if (!pyodidePromise) {
    importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js");
    pyodidePromise = loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/"
    });
  }
  if (!runnerSourcePromise) {
    runnerSourcePromise = fetch("/runner.py").then((response) => {
      if (!response.ok) throw new Error("無法載入 Python 測資執行器");
      return response.text();
    });
  }
  return Promise.all([pyodidePromise, runnerSourcePromise]);
}

self.onmessage = async (event) => {
  const { id, type, code, tests, unorderedOutput } = event.data;
  if (type !== "run") return;
  let pyodide = null;
  let response;
  try {
    self.postMessage({ id, type: "runtime-loading" });
    const runtime = await ensureRuntime();
    pyodide = runtime[0];
    const runnerSource = runtime[1];
    self.postMessage({ id, type: "executing" });
    pyodide.globals.set("USER_CODE", code);
    pyodide.globals.set("TEST_CASES_JSON", JSON.stringify(tests));
    pyodide.globals.set("UNORDERED_OUTPUT", Boolean(unorderedOutput));
    const raw = await pyodide.runPythonAsync(runnerSource);
    response = { id, type: "result", payload: JSON.parse(raw) };
  } catch (error) {
    response = {
      id,
      type: "error",
      error: error instanceof Error ? error.stack || error.message : String(error)
    };
  } finally {
    if (pyodide) {
      try {
        for (const name of [
          "USER_CODE",
          "TEST_CASES_JSON",
          "UNORDERED_OUTPUT"
        ]) {
          pyodide.globals.delete(name);
        }
        await pyodide.runPythonAsync("import gc; gc.collect()");
      } catch {
        // A failed cleanup must not replace the user's test result.
      }
    }
  }
  self.postMessage(response);
};
