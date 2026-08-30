# RECODE

RECODE is a local-first algorithm recall trainer built with Next.js. It combines a bilingual problem workspace, a browser-side Python runner, structured explanations, submission history, and FSRS-based review scheduling.

提供繁中／英文題目切換、Python 編輯器、測資執行、錯誤分析、Speed／Repeat 模式與本機 SQLite 進度保存。**題庫不隨附**：倉庫內含一題完整範例與作題 skill，其餘由你自行撰寫或匯入（原因見 `NOTICE.md`）。

## 畫面

![RECODE 工作區：左側題目與個人筆記，右側 Monaco 編輯器、歷史提交與測資結果](docs/images/workspace.jpg)

上圖是倉庫附帶的範例題 `D1 均衡切點` —— 這一題是為本倉庫撰寫的，不含任何判題網站的文字（見 `NOTICE.md`）。畫面上可以看到：

- 上方是練習模式：**引導 / 自由 / 探險 / Speed / Repeat / 模擬面試**，以及當日特訓進度
- 左欄是題目、每題獨立的 Markdown 筆記，以及可展開的結構化題解
- 右欄是 Monaco 編輯器、歷史提交，與測資執行結果；Python 由 Pyodide 在瀏覽器內執行，不經過任何伺服器
- 底部狀態列顯示 FSRS-7 排程狀態與本輪通過／失敗統計

## Features

- A validated problem format: one complete example ships, and `skills/recode-problem-author` authors the rest
- Problem sets are yours to bring; see `NOTICE.md` for why none is bundled
- Python solutions, deterministic starter skeletons, and browser-run test cases
- Structured Markdown explanations and personal notes
- FSRS-7 spaced repetition, daily training, speed, repeat, and interview modes
- Local-first progress in SQLite; no account is required
- Traditional Chinese and English problem statements

## Bringing your own problems

One complete problem ships in `recode-staging/demo-01/` and
`public/data/problems/demo-01.json` so the format is not hypothetical. It was
written for this repository, so it carries nobody else's text.

```bash
# Author a bundle from a draft, then check it — the validator runs the solution
# against its own fixtures in a sandbox.
python3 skills/recode-problem-author/scripts/derive_problem_fields.py draft.json --output recode-staging/my-problem
python3 skills/recode-problem-author/scripts/validate_bundle.py recode-staging/my-problem --run-tests --project-root .
python3 skills/recode-problem-author/scripts/build_book.py --help
```

`skills/recode-problem-author/SKILL.md` is a Claude Code skill: copy it under
`.claude/skills/` and it will fill the causal chain rather than just the answer.
`references/problem-contract.md` is the authoritative 33-key contract.

## Quick start

Requirements: Node.js 20 or newer, npm, and Python 3.

```bash
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>.

For a production build:

```bash
npm run build
npm start
```

`npm run build:data` is only for maintainers who also have the legacy source workbook modules. A normal clone uses the checked-in generated problem packages and does not regenerate them during build.

## Privacy and network behavior

The server binds to `127.0.0.1` by default. Do not expose it to a LAN or the internet without adding authentication: the state, backup, and restore APIs are intentionally local and currently unauthenticated.

Progress is stored under `.local/`, which is ignored by Git. Monaco and Pyodide are currently loaded from jsDelivr in the browser; the first editor/test run therefore needs network access. Vendoring these assets is on the open-source hardening roadmap.

## Problem authoring Skill

The shareable Codex Skill is in [`skills/recode-problem-author`](skills/recode-problem-author). It creates a staging package containing:

- `problem.json` — canonical site data
- `solution.py` — runnable Python answer
- `explanation.md` — structured human-readable explanation
- `tests.json` — runner cases

The Skill validates schema, deterministic starter/overlay alignment, Python syntax, and cross-file consistency before anything can be imported into `public/data`.

Example prompt:

```text
Use $recode-problem-author to turn this problem statement into a validated RECODE package.
```

## Internationalization

The current language toggle changes problem statements only. The full UI i18n migration is documented in [`docs/i18n.md`](docs/i18n.md); it deliberately separates UI locale, statement locale, stable category IDs, and localized explanations.

## Validation

```bash
npm run typecheck
npm test
```

## Licensing

The application code is released under the MIT License. Problem statements, source-list names, and other third-party material remain the property of their respective owners and are not relicensed by the MIT License. See [`NOTICE.md`](NOTICE.md) before redistributing a dataset.
