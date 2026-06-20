#!/usr/bin/env bash
set -euo pipefail

pr_url="$(gh pr status --json url --jq '.currentBranch.url // empty')"
branch="$(git branch --show-current || true)"
thread_id="${CODEX_THREAD_ID:-}"

if [ -z "$pr_url" ]; then
  echo "No PR found for the current branch." >&2
  exit 1
fi

gh pr merge --auto --merge "$pr_url"

if [ -z "$thread_id" ]; then
  echo "Auto-merge enabled, but CODEX_THREAD_ID is not set; skipping cleanup watcher." >&2
  exit 0
fi

if PR_MERGE_CLEANUP_PR_URL="$pr_url" \
  PR_MERGE_CLEANUP_BRANCH="$branch" \
  codex exec resume "$thread_id" 'Use $pr-merge-cleanup'; then
  codex archive "$thread_id"
  echo "Archived Codex thread: $thread_id"
else
  status="$?"
  echo "PR merge cleanup failed with status $status." >&2
  exit "$status"
fi
