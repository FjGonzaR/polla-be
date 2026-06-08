#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-}"
PATH_ARG="${2:-}"

if [[ -z "$BRANCH" ]]; then
  echo "Usage: $0 <branch-name> [worktree-path]"
  echo "  branch-name   new branch to create"
  echo "  worktree-path defaults to ../polla-be-<branch-name>"
  exit 1
fi

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WORKTREE_PATH="${PATH_ARG:-${REPO_ROOT}/../polla-be-${BRANCH}}"

git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WORKTREE_PATH"

if [[ -f "$REPO_ROOT/.env" ]]; then
  cp "$REPO_ROOT/.env" "$WORKTREE_PATH/.env"
  echo ".env copied to $WORKTREE_PATH"
else
  echo "Warning: no .env found in $REPO_ROOT — skipped copy"
fi

echo "Worktree ready: $WORKTREE_PATH (branch: $BRANCH)"
