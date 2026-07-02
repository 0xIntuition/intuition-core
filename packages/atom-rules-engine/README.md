# `@0xintuition/atom-rules-engine`

Shared atom presentation selection engine.

## Purpose

This package decides which presentation key an atom should resolve to based on:

- classification and identity
- parsed/structured atom data
- normalized enrichment artifacts

The engine does **not** decide which frontend component to render. It returns a stable `variantId` key, and each frontend maps that key to its own UI.

## Flow

1. Build a typed `DecisionContext`
   - `buildDecisionContextFromPersistedAtom(...)`
   - `buildDecisionContextFromProcessPayload(...)`
2. Normalize enrichment artifacts into canonical slugs
   - example: `product-listing`, `github-repo`, `token-metadata`
3. Resolve identity hints
   - example: `category`, `schemaType`, canonical URL, canonical ID
4. Evaluate ordered rules
   - `resolveDecision(...)`
5. Return a presentation key
   - example: `amazon-product`, `github-repo`, `coingecko-token`

## Reading The Rules

- Rule resolution lives in `src/engine.ts`.
- Executable rules live in `src/rules/` with one file per rule.
- Human-readable per-key rule snippets live in `src/rule-catalog.ts` with grouped source under `src/catalog/`.
- Real DB-derived walkthrough coverage lives in `__tests__/rules-engine.test.ts`.

`rule-catalog.ts` is the best place to quickly read:

- what a variant key means
- what identity signals it expects
- which enrichment types it considers
- precedence notes
- representative DB examples

## Boundary

The intended contract is:

```ts
const decision = resolveDecisionFromPersistedAtom(atom);
decision.variantId;
```

Frontends own the mapping from `variantId` to whatever banner, card, panel, or fallback they want to show.
