#!/bin/bash
# 11-select.sh — CLI select command (dropdown)

source "$(dirname "$0")/common.sh"

# ─────────────────────────────────────────────────────────────────
start_test "pinchtab select (dropdown)"

pt_ok nav "${FIXTURES_URL}/form.html"

# Get snapshot to find the country select ref
pt_ok snap --interactive
# The form has a country select with options

# Select by CSS selector
pt_ok select "#country" "United States"
assert_output_contains "selected" "confirms selection"

end_test
