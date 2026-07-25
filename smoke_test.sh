#!/bin/bash
# Post-deploy smoke test for Blackjack 21 on GitHub Pages.
#
# Catches the failure this stack actually has: the single-file build silently
# losing a module. Because build.js concatenates everything into one HTML file,
# a missing entry in cssFiles/jsFiles produces a page that loads fine and is
# quietly broken. Grepping the DEPLOYED html for known markers catches that in
# seconds, without a browser.
#
# Usage: ./smoke_test.sh [--wait]
#   --wait: wait 90s for the GitHub Pages deployment to go live before testing

set -e

URL="{{SHARE_BASE_URL}}"
TIMEOUT=15

if [ "$1" = "--wait" ]; then
    echo "Waiting 90s for GitHub Pages deployment..."
    sleep 90
fi

echo "Smoke test: $URL"
echo ""

# 1. Check HTTP status
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time $TIMEOUT "$URL")
if [ "$STATUS" != "200" ]; then
    echo "FAIL: HTTP status $STATUS (expected 200)"
    exit 1
fi
echo "PASS: HTTP 200 OK"

# 2. Check the page contains critical elements
PAGE=$(curl -s --max-time $TIMEOUT "$URL")

# REPLACE THESE MARKERS with this app's real element ids and function names.
# Format: "grep-pattern|human label". Pick one marker per module in
# build.js jsFiles/cssFiles plus the two or three DOM ids the app cannot work
# without — that way a dropped module fails a named check instead of silently
# shipping. Escape double quotes as \" and keep patterns literal (grep BRE).
CHECKS=(
    "id=\"screen-home\"|Home screen"
    "id=\"nav-home\"|Bottom nav"
    "firebase-app-compat|Firebase SDK"
    "function showScreen(|showScreen() function"
    "function showToast(|showToast() function"
    "function firebaseSafe(|firebaseSafe() function"
    "function signInWithGoogle(|signInWithGoogle() function"
    "function registerForPushNotifications(|push registration function"
    "\\-\\-nav-height|tokens.css inlined"
)

PASS=0
FAIL=0

for check in "${CHECKS[@]}"; do
    PATTERN="${check%%|*}"
    LABEL="${check##*|}"
    if echo "$PAGE" | grep -q "$PATTERN"; then
        echo "PASS: $LABEL present"
        ((PASS++))
    else
        echo "FAIL: $LABEL MISSING"
        ((FAIL++))
    fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ $FAIL -gt 0 ]; then
    echo "Smoke test FAILED!"
    exit 1
fi

echo "All smoke tests passed!"
