#!/bin/bash
# check-logs.sh: Extract recent errors from backend logs

SCRIPT_DIR="$(dirname "$0")"
if [[ -d "/app/storage" ]]; then
    LOG_FILE="/app/storage/logs/server.log"
else
    LOG_FILE="$SCRIPT_DIR/../../../server.log"
fi

if [[ ! -f "$LOG_FILE" ]]; then
    echo "Error: $LOG_FILE not found."
    exit 1
fi

echo "--- Recent Backend Errors (Last 20 lines) ---"
grep -Ei "error|fail|exception|500|503|403" "$LOG_FILE" | tail -n 20

echo ""
echo "--- Firestore Specific Checks ---"
grep -Ei "PERMISSION_DENIED|FAILED_PRECONDITION|index" "$LOG_FILE" | tail -n 5
