#!/bin/bash
set -euo pipefail

# GOOGLE_APPLICATION_CREDENTIALS_BASE64 (a base64-encoded GCP service account
# key, set as an environment variable in the Claude Code cloud environment
# settings) is only ever injected into the `claude` process's own
# environment -- never into the container entrypoint, environment-manager,
# or any "environment setup script" that runs before `claude` starts. So
# decoding it has to happen here, in a SessionStart hook, not in the
# environment's setup script.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if [ -z "${GOOGLE_APPLICATION_CREDENTIALS_BASE64:-}" ]; then
  echo "GOOGLE_APPLICATION_CREDENTIALS_BASE64 not set, skipping GCP credential setup" >&2
  exit 0
fi

CRED_DIR="${HOME}/credentials"
CRED_FILE="${CRED_DIR}/service-account.json"

mkdir -p "$CRED_DIR"
chmod 700 "$CRED_DIR"

# -d works on GNU coreutils, -D on macOS/BSD base64
printf '%s' "$GOOGLE_APPLICATION_CREDENTIALS_BASE64" \
  | base64 --decode > "$CRED_FILE" 2>/dev/null \
  || printf '%s' "$GOOGLE_APPLICATION_CREDENTIALS_BASE64" | base64 -D > "$CRED_FILE"

chmod 600 "$CRED_FILE"

if ! grep -q '"type"[[:space:]]*:[[:space:]]*"service_account"' "$CRED_FILE"; then
  echo "Decoded content doesn't look like a service account key" >&2
  exit 1
fi

# Persist for the rest of this Claude Code session -- plain `export` here
# would only live in this hook's own process and vanish immediately.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export GOOGLE_APPLICATION_CREDENTIALS=\"$CRED_FILE\"" >> "$CLAUDE_ENV_FILE"
fi

# Belt-and-suspenders: also write it to backend/.env, which the app's own
# dotenv loader reads fresh on every `node server.js` start regardless of
# which shell or process launched it.
if [ -n "${CLAUDE_PROJECT_DIR:-}" ] && [ -f "$CLAUDE_PROJECT_DIR/backend/package.json" ]; then
  ENV_FILE="$CLAUDE_PROJECT_DIR/backend/.env"
  touch "$ENV_FILE"
  grep -v '^GOOGLE_APPLICATION_CREDENTIALS=' "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  echo "GOOGLE_APPLICATION_CREDENTIALS=$CRED_FILE" >> "$ENV_FILE"
fi

echo "GOOGLE_APPLICATION_CREDENTIALS=$CRED_FILE"
