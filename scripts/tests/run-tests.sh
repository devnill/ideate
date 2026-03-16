#!/usr/bin/env bash
# run-tests.sh — Plain bash test harness (no external deps, bash 3.2 compatible)
#
# Usage: ./scripts/tests/run-tests.sh [test-file-pattern]
#
# Sources each test-*.sh file, discovers test_* functions, runs each in a
# subshell with a temp dir ($TEST_TMPDIR). Prints pass/fail summary.

set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$TEST_DIR"

# ── Counters ────────────────────────────────────────────────────────────────

TOTAL=0
PASSED=0
FAILED=0
FAILED_NAMES=""

# ── Assertion helpers ───────────────────────────────────────────────────────

assert_equals() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-assert_equals}"
  if [ "$expected" = "$actual" ]; then
    return 0
  else
    echo "    FAIL: $msg"
    echo "      expected: $expected"
    echo "      actual:   $actual"
    return 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="${3:-assert_contains}"
  case "$haystack" in
    *"$needle"*)
      return 0
      ;;
    *)
      echo "    FAIL: $msg"
      echo "      expected to contain: $needle"
      echo "      actual output: $haystack"
      return 1
      ;;
  esac
}

assert_file_exists() {
  local path="$1"
  local msg="${2:-assert_file_exists}"
  if [ -f "$path" ]; then
    return 0
  else
    echo "    FAIL: $msg"
    echo "      file does not exist: $path"
    return 1
  fi
}

assert_exit_code() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-assert_exit_code}"
  if [ "$expected" = "$actual" ]; then
    return 0
  else
    echo "    FAIL: $msg"
    echo "      expected exit code: $expected"
    echo "      actual exit code:   $actual"
    return 1
  fi
}

# ── Export helpers so subshells can use them ─────────────────────────────────

export -f assert_equals
export -f assert_contains
export -f assert_file_exists
export -f assert_exit_code
export SCRIPT_DIR

# ── Test runner ─────────────────────────────────────────────────────────────

run_test_function() {
  local func_name="$1"
  local test_file="$2"
  local tmpdir
  tmpdir="$(mktemp -d)"

  (
    export TEST_TMPDIR="$tmpdir"
    # Source the test file to get all functions and fixtures
    . "$test_file"
    # Run the test function
    "$func_name"
  )
  local rc=$?

  # Clean up temp dir
  rm -rf "$tmpdir"

  return $rc
}

# ── Main ────────────────────────────────────────────────────────────────────

FILE_PATTERN="${1:-test-*.sh}"

echo "=== Test Suite ==="
echo ""

# Collect test files
test_files=""
for f in "$TEST_DIR"/$FILE_PATTERN; do
  if [ -f "$f" ]; then
    test_files="$test_files $f"
  fi
done

if [ -z "$test_files" ]; then
  echo "No test files found matching: $FILE_PATTERN"
  exit 1
fi

for test_file in $test_files; do
  filename="$(basename "$test_file")"
  echo "--- $filename ---"

  # Discover test_ functions by grepping for function definitions
  funcs="$(grep -oE '^test_[a-zA-Z0-9_]+' "$test_file" | grep -v '()' | sort -u)"
  # Also try the pattern "test_name()"
  if [ -z "$funcs" ]; then
    funcs="$(grep -oE 'test_[a-zA-Z0-9_]+\s*\(\)' "$test_file" | sed 's/[() ]//g' | sort -u)"
  fi

  if [ -z "$funcs" ]; then
    echo "  (no test_ functions found)"
    continue
  fi

  for func in $funcs; do
    TOTAL=$((TOTAL + 1))
    printf "  %-50s " "$func"

    output="$(run_test_function "$func" "$test_file" 2>&1)"
    rc=$?

    if [ $rc -eq 0 ]; then
      echo "PASS"
      PASSED=$((PASSED + 1))
    else
      echo "FAIL"
      FAILED=$((FAILED + 1))
      FAILED_NAMES="$FAILED_NAMES    $func ($filename)"$'\n'
      if [ -n "$output" ]; then
        echo "$output" | while IFS= read -r line; do
          echo "    $line"
        done
      fi
    fi
  done

  echo ""
done

# ── Summary ─────────────────────────────────────────────────────────────────

echo "=== Results ==="
echo "  Total:  $TOTAL"
echo "  Passed: $PASSED"
echo "  Failed: $FAILED"

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "  Failed tests:"
  echo "$FAILED_NAMES"
  exit 1
fi

exit 0
