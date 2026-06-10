#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-}"
FORCE=""

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <branch-name|worktree-path> [--force]"
  echo "  branch-name    worktree at ../polla-be-<branch-name> (also deletes the branch)"
  echo "  worktree-path  explicit path to the worktree"
  echo "  --force        discard uncommitted changes and force branch deletion"
  exit 1
fi

if [[ "${2:-}" == "--force" ]]; then
  FORCE="--force"
fi

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

# Resolve worktree path: explicit path if it exists, else convention.
if [[ -d "$TARGET" ]]; then
  WORKTREE_PATH="$(cd "$TARGET" && pwd)"
else
  WORKTREE_PATH="${REPO_ROOT}/../polla-be-${TARGET}"
fi

if [[ ! -d "$WORKTREE_PATH" ]]; then
  echo "Error: worktree not found at $WORKTREE_PATH"
  exit 1
fi

# Branch tied to this worktree (for deletion after removal).
BRANCH="$(git -C "$WORKTREE_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

git -C "$REPO_ROOT" worktree remove $FORCE "$WORKTREE_PATH"
echo "Worktree removed: $WORKTREE_PATH"

if [[ -n "$BRANCH" && "$BRANCH" != "HEAD" ]]; then
  if [[ -n "$FORCE" ]]; then
    git -C "$REPO_ROOT" branch -D "$BRANCH"
  else
    git -C "$REPO_ROOT" branch -d "$BRANCH"
  fi
  echo "Branch deleted: $BRANCH"
fi
