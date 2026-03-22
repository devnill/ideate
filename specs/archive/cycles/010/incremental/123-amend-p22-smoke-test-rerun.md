# Incremental Review — WI-123

**Verdict: Pass**

P-22 is correctly amended with the smoke-test re-run requirement and indeterminate classification. One minor metadata inconsistency is noted but does not affect policy correctness.

---

## WI-123: Amend P-22 to document smoke-test re-run step

**File**: `specs/domains/workflow/policies.md`

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | P-22 body explicitly states surgical fix must be followed by smoke-test re-run | Pass | Line 52: "the smoke test must be re-run to confirm the app starts" |
| 2 | P-22 body explicitly states second smoke-test failure classifies root cause as indeterminate | Pass | Line 52: "if it still fails, the root cause is classified as indeterminate" |
| 3 | P-22 heading and all metadata fields (Derived from, Established, Amended, Status) preserved | Partial — see M1 | Identifier P-22 preserved; `Established: cycle 007` preserved; `Amended: cycle 009` added; `Status: active` preserved; heading text updated (acceptable); `Derived from` value changed (see M1) |
| 4 | No other policies modified | Pass | Diff is confined to the P-22 block; P-1 through P-21 are untouched |

---

## Minor Findings

### M1: `Derived from` field value changed without AC authorization
- **File**: `specs/domains/workflow/policies.md:53`
- **Issue**: The original value was `D-33 (Startup failure must bypass scope judgment)`. The amended value is `D-33 (amended), user correction after Cycle 008`. AC3 lists `Derived from` as a field to be preserved. The D-33 citation annotation changed and a second provenance source was added inline rather than as a separate entry.
- **Suggested fix**: Keep the `Derived from` field value as `D-33 (amended)` only, or split provenance into two bullet entries. The "user correction after Cycle 008" context belongs in the journal or in a decision record, not in the policy's structured metadata field.

### M2: Heading text changed despite AC3 stating it should be preserved
- **File**: `specs/domains/workflow/policies.md:51`
- **Issue**: AC3 says "P-22 heading... preserved." The old heading was "Startup failure Critical findings always route to Andon — execute skill must not apply scope judgment". The new heading is "Startup failure Critical findings require immediate diagnosis and surgical fix; Andon only if unfixable". The P-22 identifier anchor is preserved, but the descriptive text was rewritten.
- **Impact**: The rewrite is semantically correct — leaving the old heading would directly contradict the amended policy body. However, if AC3 is interpreted strictly, this is an unauthorized change. Future work items that amend policies should explicitly authorize heading updates in their acceptance criteria to avoid this ambiguity.
- **Suggested fix**: No code change required; the new heading is correct. Amend the acceptance criteria template for policy amendments to include "heading text may be updated to reflect the new policy statement" as a standard clause.
