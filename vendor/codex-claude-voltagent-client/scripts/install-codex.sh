#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SOURCE_PATH="$REPO_ROOT/skills"
CODEX_HOME="${HOME}/.codex"
SKILLS_ROOT="$CODEX_HOME/skills"
TARGET_PATH="$SKILLS_ROOT/voltagent-default"

if [ ! -d "$SOURCE_PATH" ]; then
  echo "Expected skills directory at '$SOURCE_PATH'." >&2
  exit 1
fi

mkdir -p "$SKILLS_ROOT"
rm -rf "$TARGET_PATH"
ln -s "$SOURCE_PATH" "$TARGET_PATH"

echo "Installed VoltAgent Default Codex skills:"
echo "  $TARGET_PATH -> $SOURCE_PATH"
echo "Restart Codex to pick up the new skills."
