#!/usr/bin/env bash
# test-migrate-to-optimized.sh — Tests for migrate-to-optimized.sh

FIXTURE_DIR="$SCRIPT_DIR/fixtures"
MIGRATE_SCRIPT="$SCRIPT_DIR/../migrate-to-optimized.sh"

setup_artifact_dir() {
  # Create minimal artifact dir structure that passes validation
  mkdir -p "$TEST_TMPDIR/artifact/steering"
  mkdir -p "$TEST_TMPDIR/artifact/plan/work-items"
  echo "# Guiding Principles" > "$TEST_TMPDIR/artifact/steering/guiding-principles.md"

  # Copy sample work item fixtures
  cp "$FIXTURE_DIR/sample-work-items/001-first-item.md" "$TEST_TMPDIR/artifact/plan/work-items/"
  cp "$FIXTURE_DIR/sample-work-items/002-second-item.md" "$TEST_TMPDIR/artifact/plan/work-items/"
}

# ── Tests ───────────────────────────────────────────────────────────────────

test_dry_run_no_changes() {
  setup_artifact_dir

  local output
  output="$(bash "$MIGRATE_SCRIPT" --dry-run "$TEST_TMPDIR/artifact" 2>&1)"
  local rc=$?

  assert_exit_code "2" "$rc" "dry-run with pending changes should exit 2"

  if [ -f "$TEST_TMPDIR/artifact/plan/work-items.yaml" ]; then
    echo "    FAIL: work-items.yaml should not be created in dry-run"
    return 1
  fi
}

test_yaml_conversion() {
  setup_artifact_dir

  local output
  output="$(bash "$MIGRATE_SCRIPT" "$TEST_TMPDIR/artifact" 2>&1)"
  local rc=$?

  assert_file_exists "$TEST_TMPDIR/artifact/plan/work-items.yaml" \
    "work-items.yaml should be created after migration"

  # Check originals were moved to legacy
  if [ -f "$TEST_TMPDIR/artifact/plan/work-items/001-first-item.md" ]; then
    echo "    FAIL: original 001-first-item.md should have been moved to work-items-legacy"
    return 1
  fi

  assert_file_exists "$TEST_TMPDIR/artifact/plan/work-items-legacy/001-first-item.md" \
    "001-first-item.md should exist in work-items-legacy"
  assert_file_exists "$TEST_TMPDIR/artifact/plan/work-items-legacy/002-second-item.md" \
    "002-second-item.md should exist in work-items-legacy"
}

test_yaml_valid() {
  setup_artifact_dir

  # Run migration first
  bash "$MIGRATE_SCRIPT" "$TEST_TMPDIR/artifact" >/dev/null 2>&1

  # Verify the generated YAML is parseable
  local output
  output="$(python3 -c "import yaml; yaml.safe_load(open('$TEST_TMPDIR/artifact/plan/work-items.yaml'))" 2>&1)"
  local rc=$?

  assert_exit_code "0" "$rc" "generated YAML should be valid and parseable by python3"
}

test_idempotent() {
  setup_artifact_dir

  # First run
  bash "$MIGRATE_SCRIPT" "$TEST_TMPDIR/artifact" >/dev/null 2>&1

  # Second run
  local output
  output="$(bash "$MIGRATE_SCRIPT" "$TEST_TMPDIR/artifact" 2>&1)"
  local rc=$?

  assert_exit_code "0" "$rc" "second run should exit 0"
  assert_contains "$output" "already exists" "second run should say already exists — skipping"
}
