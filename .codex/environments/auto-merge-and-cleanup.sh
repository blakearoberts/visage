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

if codex exec resume \
  --last \
  --output-last-message "$archive_decision_file" \
  - <<PROMPT
Use \$pr-merge-cleanup.

PR URL: $pr_url
Local branch: $branch

This request came from the Visage Codex Auto-Merge action. After the skill
finishes, include these exact lines by themselves if and only if cleanup
succeeded, no user follow-up is needed, and CODEX_THREAD_ID is available:

CODEX_PR_MERGE_CLEANUP_ARCHIVE=ready
CODEX_PR_MERGE_CLEANUP_THREAD_ID=<current CODEX_THREAD_ID>

Do not include archive markers otherwise.
PROMPT
then
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
