#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

CLEAN_DIRECTORIES=(
  "dist"
  "coverage"
  "tmp"
)

CLEAN_GLOBS=(
  "dashboard/*.map"
  "dashboard/*.js.map"
)

removed_any=0

remove_path() {
  local path="$1"
  if [ -e "$path" ] || [ -L "$path" ]; then
    rm -rf "$path"
    echo "Removed $path"
    removed_any=1
  fi
}

for dir in "${CLEAN_DIRECTORIES[@]}"; do
  remove_path "$dir"
done

shopt -s nullglob
for glob in "${CLEAN_GLOBS[@]}"; do
  for match in $glob; do
    remove_path "$match"
  done
done
shopt -u nullglob

while IFS= read -r file; do
  remove_path "$file"
done < <(find . -path './.git' -prune -o -type f -name '.DS_Store' -print)

if [ $removed_any -eq 0 ]; then
  echo "Nothing to clean"
fi
