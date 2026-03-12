#!/bin/bash
# 07-screenshot.sh — CLI screenshot command

source "$(dirname "$0")/common.sh"

# ─────────────────────────────────────────────────────────────────
start_test "pinchtab ss (screenshot)"

pt_ok nav "${FIXTURES_URL}/buttons.html"

# Screenshot outputs binary data to stdout by default
# Just verify it succeeds and outputs something
pt ss
if [ "$PT_CODE" -eq 0 ] && [ -n "$PT_OUT" ]; then
  echo -e "  ${GREEN}✓${NC} screenshot succeeded"
  ((ASSERTIONS_PASSED++)) || true
else
  echo -e "  ${RED}✗${NC} screenshot failed or empty"
  ((ASSERTIONS_FAILED++)) || true
fi

end_test

# ─────────────────────────────────────────────────────────────────
start_test "pinchtab ss -o <file>"

TMPFILE="/tmp/test-screenshot-$$.jpg"
pt_ok ss -o "$TMPFILE"

if [ -f "$TMPFILE" ] && [ -s "$TMPFILE" ]; then
  echo -e "  ${GREEN}✓${NC} screenshot saved to file"
  ((ASSERTIONS_PASSED++)) || true
  rm -f "$TMPFILE"
else
  echo -e "  ${RED}✗${NC} screenshot file not created or empty"
  ((ASSERTIONS_FAILED++)) || true
fi

end_test
