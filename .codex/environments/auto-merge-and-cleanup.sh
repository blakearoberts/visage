#!/usr/bin/env bash
set -euo pipefail

pr_url="$(gh pr status --json url --jq '.currentBranch.url // empty')"
branch="$(git branch --show-current || true)"
archive_marker="CODEX_PR_MERGE_CLEANUP_ARCHIVE=ready"
thread_id_marker_prefix="CODEX_PR_MERGE_CLEANUP_THREAD_ID="

if [ -z "$pr_url" ]; then
  echo "No PR found for the current branch." >&2
  exit 1
fi

gh pr merge --auto --merge "$pr_url"

archive_decision_file="$(mktemp)"
trap 'rm -f "$archive_decision_file"' EXIT

if PR_MERGE_CLEANUP_PR_URL="$pr_url" \
  PR_MERGE_CLEANUP_BRANCH="$branch" \
  codex exec resume \
    --last \
    --output-last-message "$archive_decision_file" \
    'Use $pr-merge-cleanup'; then
  if grep -Fxq "$archive_marker" "$archive_decision_file"; then
    thread_id="$(
      sed -n "s/^$thread_id_marker_prefix//p" "$archive_decision_file" | tail -n 1
    )"
    if [ -z "$thread_id" ]; then
      echo "Cleanup turn requested archive but did not report a thread id." >&2
      exit 1
    fi

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
