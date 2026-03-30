#!/bin/bash
# verify-health.sh: Check API endpoint health

BASE_URL="http://localhost:3005"

endpoints=(
    "/api/voices"
    "/api/titles"
)

echo "--- Endpoint Health Check ($BASE_URL) ---"

for ep in "${endpoints[@]}"; do
    response=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$ep")
    if [[ "$response" -ge 200 && "$response" -lt 300 ]]; then
        echo "SUCCESS: $ep -> $response"
    else
        echo "FAILURE: $ep -> $response"
        # Print actual error if possible
        curl -s "$BASE_URL$ep" | tail -n 5
    fi
done

echo ""
echo "--- Storage Base Path Check ---"
SCRIPT_DIR="$(dirname "$0")"
if [[ -d "$SCRIPT_DIR/../../../backend/audio_files" || -d "/app/storage" ]]; then
    echo "Found storage directory."
else
    echo "WARNING: storage directory NOT found at $SCRIPT_DIR/../../../backend/audio_files"
fi
