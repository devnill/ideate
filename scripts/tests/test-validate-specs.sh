#!/usr/bin/env bash
# test-validate-specs.sh — Tests for validate-specs.sh

FIXTURE_DIR="$SCRIPT_DIR/fixtures"
VALIDATE_SCRIPT="$SCRIPT_DIR/../validate-specs.sh"

setup_artifact_dir() {
  local yaml_fixture="$1"
  mkdir -p "$TEST_TMPDIR/plan"
  cp "$yaml_fixture" "$TEST_TMPDIR/plan/work-items.yaml"
}

# ── Tests ───────────────────────────────────────────────────────────────────

test_dag_no_cycles() {
  setup_artifact_dir "$FIXTURE_DIR/valid-work-items.yaml"

  local output
  output="$(bash "$VALIDATE_SCRIPT" dag "$TEST_TMPDIR" 2>&1)"
  local rc=$?

  assert_exit_code "0" "$rc" "dag on valid items should exit 0"
  assert_contains "$output" "no cycles" "output should mention no cycles"
}

test_dag_with_cycle() {
  setup_artifact_dir "$FIXTURE_DIR/cyclic-deps.yaml"

  local output
  output="$(bash "$VALIDATE_SCRIPT" dag "$TEST_TMPDIR" 2>&1)"
  local rc=$?

  assert_exit_code "1" "$rc" "dag on cyclic items should exit 1"
  assert_contains "$output" "CYCLE DETECTED" "output should contain CYCLE DETECTED"
}

test_overlap_detected() {
  setup_artifact_dir "$FIXTURE_DIR/overlap-scope.yaml"

  local output
  output="$(bash "$VALIDATE_SCRIPT" overlap "$TEST_TMPDIR" 2>&1)"
  local rc=$?

  assert_exit_code "1" "$rc" "overlap on conflicting scopes should exit 1"
  assert_contains "$output" "OVERLAP" "output should contain OVERLAP"
}

test_overlap_sequenced_ok() {
  # Items share paths but one depends on the other, so overlap is OK
  mkdir -p "$TEST_TMPDIR/plan"
  cat > "$TEST_TMPDIR/plan/work-items.yaml" <<'YAML'
items:
  "001":
    title: First modifier
    complexity: low
    scope:
      - {path: src/shared.ts, op: modify}
    depends: []
    blocks: ["002"]
    criteria:
      - 'shared.ts modified first'
  "002":
    title: Second modifier
    complexity: low
    scope:
      - {path: src/shared.ts, op: modify}
    depends: ["001"]
    blocks: []
    criteria:
      - 'shared.ts modified second'
YAML

  local output
  output="$(bash "$VALIDATE_SCRIPT" overlap "$TEST_TMPDIR" 2>&1)"
  local rc=$?

  assert_exit_code "0" "$rc" "overlap on sequenced items should exit 0"
}

test_coverage_missing_criteria() {
  mkdir -p "$TEST_TMPDIR/plan"
  cat > "$TEST_TMPDIR/plan/work-items.yaml" <<'YAML'
items:
  "001":
    title: No criteria item
    complexity: low
    scope:
      - {path: src/foo.ts, op: create}
    depends: []
    blocks: []
    criteria: []
YAML

  local output
  output="$(bash "$VALIDATE_SCRIPT" coverage "$TEST_TMPDIR" 2>&1)"
  local rc=$?

  assert_exit_code "1" "$rc" "coverage with empty criteria should exit 1"
  assert_contains "$output" "ERROR: item" "output should contain ERROR: item"
}

test_lint_vague_terms() {
  setup_artifact_dir "$FIXTURE_DIR/vague-criteria.yaml"

  local output
  output="$(bash "$VALIDATE_SCRIPT" lint "$TEST_TMPDIR" 2>&1)"
  local rc=$?

  assert_contains "$output" "LINT" "output should contain LINT for vague terms"
}

test_lint_clean() {
  setup_artifact_dir "$FIXTURE_DIR/valid-work-items.yaml"

  local output
  output="$(bash "$VALIDATE_SCRIPT" lint "$TEST_TMPDIR" 2>&1)"
  local rc=$?

  assert_contains "$output" "no vague" "output should say no vague terms found"
}
