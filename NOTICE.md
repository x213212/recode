# Third-party content notice

The MIT License in this repository applies to the RECODE application code and original project documentation.

Problem statements, problem titles, source-list names, trademarks, and links may originate from LeetCode or other study-list publishers. Those materials remain subject to their original owners' terms and are not relicensed under MIT by this repository.

Before publishing or redistributing a generated problem dataset, verify that you have the necessary rights. The recommended open-source deployment model is to keep the engine public and generate or import datasets from content that each user is permitted to use.

## Upstream projects

Everything this project builds on, with the licence each one grants. None is
vendored into this repository; npm packages are fetched at install time and the
Python runtime is fetched by the browser at run time.

### Runtime dependencies (npm)

| Package | Licence |
| --- | --- |
| `next` | MIT |
| `react`, `react-dom` | MIT |
| `monaco-editor`, `@monaco-editor/react` | MIT |
| `react-markdown`, `remark-gfm`, `rehype-highlight` | MIT |
| `@wasm-fmt/ruff_fmt` | MIT |
| `lucide-react` | ISC |
| `typescript` (dev) | Apache-2.0 |

### Python in the browser

**Pyodide** — MPL-2.0 — <https://pyodide.org>. Loaded from a CDN at run time by
`public/pyodide-worker.js` and not redistributed here. Solutions execute in the
visitor's browser; this project runs no code on a server.

### Scheduling algorithm

`lib/fsrs.ts` implements **FSRS-7** (Free Spaced Repetition Scheduler,
open-spaced-repetition). The constant `FSRS7_REFERENCE` in that file records the
exact commit, formula and default-parameter table that were referenced:

    open-spaced-repetition/srs-benchmark @ 1053082

Two things are worth stating plainly, because they are the reason this is not a
licence problem:

- **That reference repository declares no licence.** Under default copyright its
  code may not be copied.
- **No code was copied.** `lib/fsrs.ts` is an independent TypeScript
  implementation written from the published formula and parameter table. An
  algorithm is not itself copyrightable; a particular expression of it is, and
  none of theirs is here.

The algorithm's canonical implementations — `fsrs4anki` and `ts-fsrs`, both MIT —
are cited for the same reason: credit is owed to the work even where no licence
compels it.

### Tooling referenced but not included

`scripts/build_problem_data.py` and `scripts/sync_difficulties.py` read a sibling
book tree that is not part of this repository. They are kept as a worked example
of the mapping into `public/data/`, not as scripts to run unchanged.

## Trademarks

LeetCode is a trademark of its owner. This project is not affiliated with,
endorsed by, or sponsored by them.

The name is not used to identify this software: the package, the interface title
and the storage keys carry no third-party mark. Where the name still appears it
is a reference to the thing itself — the notice above about whose rights the
problem statements are, the names of study lists such as those published by judge sites, and code
comments explaining a convention the runner has to match. That is nominative use:
you cannot describe compatibility with something without naming it.
