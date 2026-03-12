#!/bin/bash
# 09-health.sh — CLI health and status commands

source "$(dirname "$0")/common.sh"

# ─────────────────────────────────────────────────────────────────
start_test "pinchtab health"

pt_ok health
assert_output_json
assert_output_contains "status" "returns status field"

end_test

# ─────────────────────────────────────────────────────────────────
start_test "pinchtab instances"

pt_ok instances
assert_output_json
assert_output_contains "instances" "returns instances array"

end_test

# ─────────────────────────────────────────────────────────────────
start_test "pinchtab profiles"

pt_ok profiles
assert_output_json
# May be empty but should be valid JSON

end_test
