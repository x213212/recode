# Markdown explanation and book contract

Write from requirement to invariant to code. Explain why each decision is necessary; do not merely narrate syntax.

Use the teaching fields in this order:

1. `goal` — exact deliverable and constraints
2. `facts` — facts established directly by the statement
3. `friction` — why the obvious route is insufficient
4. `route` — decisions that force the algorithmic spine
5. `state` — minimal runtime state and its meaning
6. `diagram` — one compact relationship or transition
7. `derivation` — numbered causal steps with exact code snippets
8. `trace` — one complete representative walk-through
9. `proof` — initialization, invariant, progress, termination, correctness
10. `wrongAlternative` — a plausible failure and counterexample
11. `rebuild` — concise reconstruction checklist
12. `memoryLine` — one accurate compression sentence

Also preserve `premise`, `memoryCard`, and `standaloneSummary` in the exported Markdown. Each derivation step uses `#### 第 N 步｜...` (or its requested-locale equivalent) and includes the corresponding Python snippet in solution order. State time and space complexity explicitly.

## Book structure

- front matter: title, locale, generated timestamp, source/provenance notice
- table of contents grouped by stable category order
- one category heading per chapter
- one problem heading with identity, title, difficulty, and sources
- statement in the selected locale with an explicit fallback label if missing
- structured explanation in the order above
- final `solution.py` fenced block and executable examples
- a page break marker between problems (`<div class="page-break"></div>`), which later renderers may honor

Never silently translate code identifiers, complexity, edge conditions, or mathematical claims. If a locale is incomplete, keep the verified source language and label the fallback.
