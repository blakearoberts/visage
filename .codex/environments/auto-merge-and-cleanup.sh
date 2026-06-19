#!/usr/bin/env bash
set -euo pipefail

pr_url="$(gh pr status --json url --jq '.currentBranch.url // empty')"
branch="$(git branch --show-current || true)"
thread_id="${CODEX_THREAD_ID:-}"

if [ -z "$pr_url" ]; then
  echo "No PR found for the current branch." >&2
  exit 1
fi

gh pr merge --auto --merge --delete-branch "$pr_url"

if [ -z "$thread_id" ]; then
  echo "Auto-merge enabled, but CODEX_THREAD_ID is not set; skipping cleanup watcher." >&2
  exit 0
fi

log_dir="${TMPDIR:-/tmp}/codex-pr-merge-cleanup"
mkdir -p "$log_dir"
log_file="$log_dir/pr-merge-cleanup-$(date -u +%Y%m%dT%H%M%SZ).log"

nohup env \
  PR_MERGE_CLEANUP_PR_URL="$pr_url" \
  PR_MERGE_CLEANUP_BRANCH="$branch" \
  bash -c '
    set -euo pipefail

    thread_id="$1"
    prompt="$2"

    if codex exec resume "$thread_id" "$prompt"; then
      codex archive "$thread_id"
      echo "Archived Codex thread: $thread_id"
    else
      status="$?"
      echo "PR merge cleanup failed with status $status; leaving thread unarchived." >&2
      exit "$status"
    fi
  ' pr-merge-cleanup "$thread_id" 'Use $pr-merge-cleanup' \
  >"$log_file" 2>&1 &

echo "Started PR merge cleanup watcher. Log: $log_file"
