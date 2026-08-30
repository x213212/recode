# RECODE problem v2 contract

`problem.json` contains exactly 33 keys. Unknown keys are rejected so schema changes remain explicit.

## Summary fields

- `id`: lowercase slug matching `^[a-z0-9][a-z0-9_-]*$`; never starts with `._`
- `order`: positive integer
- `identity`, `title`, `category`: non-empty strings
- `difficulty`: `easy`, `medium`, or `hard`
- `sources`: non-empty unique string array
- `testCount`: exact length of `tests`
- `runnable`: `true` for an importable bundle

## Problem content

- `url`: string; it may be empty
- `statementZh`, `statementEn`: non-empty Markdown strings
- Required teaching strings: `goal`, `premise`, `facts`, `friction`, `state`, `memoryCard`, `diagram`, `route`, `derivation`, `proof`, `trace`, `wrongAlternative`, `rebuild`, `memoryLine`, `standaloneSummary`
- `pythonTools`: array of `{id,name,note,example}` with unique IDs; it may be empty

## Code and execution

- `answer`: complete UTF-8 Python source
- `overlayAnswer`: deterministic import-free class/function projection of `answer`
- `starter`: deterministic signature-only skeleton line-aligned with `overlayAnswer`
- `tests`: one or more `{name,input,expected}` objects with unique names
- `unorderedOutput`: boolean; use only when top-level result order is explicitly irrelevant

`solution.py`, normalized to LF and without one trailing newline, equals `answer`. `tests.json` deep-equals `tests`. `explanation.md` is generated from teaching fields and is never parsed back into canonical data.

## Test grammar

Ordinary cases use literal keyword assignments whose names match the public solution method:

```text
nums = [2,7,11,15], target = 9
```

Values and expected results are literal scalars or literal containers. Reject calls, attributes, comprehensions, lambdas, imports, and executable expressions.

Design problems use `operations = [...]` and `arguments = [...]`. Both arrays have equal length; the first operation matches the class; expected output has the same length and a null constructor result.

## Import behavior

Default authoring stops at staging. An explicit import must reject existing IDs unless replacement was requested, preserve order/metadata on replacement unless asked otherwise, assign `max(order)+1` for a new ID, recompute index aggregates, validate a complete temporary dataset, and atomically replace files only after every gate passes.
