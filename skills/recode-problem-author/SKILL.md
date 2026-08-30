---
name: recode-problem-author
description: Create or revise validated RECODE problem bundles with structured Markdown explanations, Python solutions, executable tests, and generated books. Use for RECODE problem authoring, validation, or book generation; do not use for ordinary practice progress or UI changes.
---

# RECODE Problem Author

Use Markdown as the maintained explanation source. Derive the website package, `solution.py`, tests, and books from the same validated content so outputs cannot drift.

## Choose a mode

- **Author new:** create a staging bundle from material the user supplied or is permitted to use.
- **Refresh existing:** preserve the existing ID, order, statements, metadata, and verified tests unless the user explicitly requests replacement.
- **Validate only:** inspect a bundle without rewriting or importing it.
- **Build book:** combine validated bundles or the checked-in problem index into an ordered Markdown book.
- **Import:** only when explicitly requested. Validate a complete staging dataset first, show add/replace impact, then update one detail file and the index atomically.

Before any mode, read [references/problem-contract.md](references/problem-contract.md). When authoring or revising explanations, also read [references/writing-contract.md](references/writing-contract.md).

## Authoring workflow

1. Locate the RECODE root from `RECODE_PROJECT_ROOT` or the nearest `package.json` named `recode-leetcode-recall`.
2. Confirm provenance. Do not scrape, reproduce locked/paywalled material, or imply redistribution rights. A URL alone is not permission to copy text.
3. Work under `recode-staging/<problem-id>/` unless another staging location is requested. Never write `.local/` or live `public/data/` by default.
4. Write a canonical v2 draft JSON with a reviewed Python answer and independently reasoned tests. Do not hand-author `overlayAnswer`, `starter`, `testCount`, or `runnable`.
5. Materialize the Markdown, `.py`, tests, and derived fields:

   ```bash
   python3 skills/recode-problem-author/scripts/derive_problem_fields.py \
     recode-staging/<problem-id>/draft.json \
     --output recode-staging/<problem-id>
   ```

6. Validate the bundle:

   ```bash
   python3 skills/recode-problem-author/scripts/validate_bundle.py \
     recode-staging/<problem-id>
   ```

7. After reviewing executable content, use `--run-tests --project-root /path/to/recode` to run cases inside the Linux bubblewrap sandbox. Never request escalated permissions for generated code.
8. Report paths, provenance, complexity, validation evidence, and inferred or untranslated content. Never claim tests passed unless the runner actually passed.

## Book workflow

Build a single Markdown book from the validated site index:

```bash
python3 skills/recode-problem-author/scripts/build_book.py \
  --data-root public/data \
  --output recode-staging/books/recode.zh-TW.md \
  --locale zh-TW
```

The book generator follows index order, creates a table of contents and category chapters, includes the maintained explanation plus `solution.py`, and never reads AppleDouble `._*` files. Markdown is the canonical portable book output; HTML/PDF conversion is a separate renderer step so authoring is not tied to one proprietary tool.

## Invariants

- `problem.json` is the website import source. `solution.py`, `tests.json`, and `explanation.md` are materialized views and must match it.
- Prefer 3–5 cases: supplied examples plus boundaries. Never use the generated solution as the only oracle.
- Current v2 localizes only `statementZh` and `statementEn`; teaching fields remain Traditional Chinese. Do not add silently ignored locale fields before a schema migration.
- Do not run legacy `scripts/build_problem_data.py` during ordinary authoring. It rewrites the whole dataset and depends on private modules absent from this backup.
