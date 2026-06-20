#!/usr/bin/env bash
set -euo pipefail

pr_url="$(gh pr status --json url --jq '.currentBranch.url // empty')"
branch="$(git branch --show-current || true)"
thread_id="${CODEX_THREAD_ID:-}"
archive_marker="CODEX_PR_MERGE_CLEANUP_ARCHIVE=ready"

if [ -z "$pr_url" ]; then
  echo "No PR found for the current branch." >&2
  exit 1
fi

gh pr merge --auto --merge "$pr_url"

if [ -z "$thread_id" ]; then
  echo "Auto-merge enabled, but CODEX_THREAD_ID is not set; skipping cleanup watcher." >&2
  exit 0
fi

archive_decision_file="$(mktemp)"
trap 'rm -f "$archive_decision_file"' EXIT

if PR_MERGE_CLEANUP_PR_URL="$pr_url" \
  PR_MERGE_CLEANUP_BRANCH="$branch" \
  codex exec resume \
    --output-last-message "$archive_decision_file" \
    "$thread_id" \
    'Use $pr-merge-cleanup'; then
  if grep -Fxq "$archive_marker" "$archive_decision_file"; then
    codex archive "$thread_id"
    echo "Archived Codex thread: $thread_id"
  else
    echo "Cleanup turn completed without archive marker; skipping archive."
  fi
else
  status="$?"
  echo "PR merge cleanup failed with status $status." >&2
  exit "$status"
fi
