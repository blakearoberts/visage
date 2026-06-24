#!/usr/bin/env bash
set -euo pipefail

pr_create_attempts=15
pr_create_poll_interval_seconds=2
pr_url=""
branch=""

while [ "$pr_create_attempts" -gt 0 ]; do
  branch="$(git branch --show-current || true)"

  if [ -n "$branch" ]; then
    pr_url="$(gh pr list --head "$branch" --state open --json url --jq '.[0].url // empty')"
  fi

  if [ -n "$pr_url" ]; then
    break
  fi

  pr_create_attempts=$((pr_create_attempts - 1))
  if [ "$pr_create_attempts" -gt 0 ]; then
    sleep "$pr_create_poll_interval_seconds"
  fi
done

if [ -z "$branch" ]; then
  echo "Timed out waiting for the create PR flow to check out a local branch." >&2
  exit 1
fi

if [ -z "$pr_url" ]; then
  echo "Timed out waiting for a PR for the current branch: $branch" >&2
  exit 1
fi

is_draft="$(gh pr view "$pr_url" --json isDraft --jq '.isDraft')"

if [ "$is_draft" = "true" ]; then
  echo "Marking draft PR ready for review: $pr_url"
  gh pr ready "$pr_url"
fi

gh pr merge --auto --merge "$pr_url"

set +e
PR_MERGE_CLEANUP_PR_URL="$pr_url" \
  PR_MERGE_CLEANUP_BRANCH="$branch" \
  bash .agents/skills/pr-merge-cleanup/scripts/watch-pr-merge-and-cleanup.sh
cleanup_status="$?"
set -e

if [ "$cleanup_status" -eq 0 ]; then
  exit 0
fi

echo "PR merge cleanup failed with status $cleanup_status; starting Codex RCA." >&2

if ! codex exec --ephemeral - <<PROMPT
The Visage Codex Auto-Merge action enabled auto-merge, then the direct cleanup
watcher failed.

PR URL: $pr_url
Local branch: $branch
Watcher exit status: $cleanup_status

Perform RCA for the failed cleanup. Inspect the PR, checks, and local Git state
as needed. Report the likely root cause, the evidence, and the safest next
action. Start with required PR checks because the watcher exits early when a
required check fails or is canceled before merge.

Do not rerun the auto-merge action or mutating cleanup watcher, do not merge or
close the PR, do not delete branches, and do not archive any Codex session.
PROMPT
then
  echo "Codex RCA failed; preserving watcher failure status $cleanup_status." >&2
fi

exit "$cleanup_status"
