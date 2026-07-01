#!/usr/bin/env bash
set -euo pipefail

timeout_seconds=900
poll_interval_seconds=15
dry_run=0

usage() {
  cat <<'USAGE'
Usage: watch-pr-merge-and-cleanup.sh [--dry-run]

Environment:
  PR_MERGE_CLEANUP_PR_URL      GitHub pull request URL to watch.
  PR_MERGE_CLEANUP_BRANCH      Local PR branch to delete after merge.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      dry_run=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 127
  fi
}

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Required environment variable is missing: $name" >&2
    exit 2
  fi
}

need_cmd gh
need_cmd git
need_cmd date
need_cmd sleep

require_env PR_MERGE_CLEANUP_PR_URL
require_env PR_MERGE_CLEANUP_BRANCH

pr_url="$PR_MERGE_CLEANUP_PR_URL"
branch="$PR_MERGE_CLEANUP_BRANCH"

read_pr_metadata() {
  gh pr view "$pr_url" \
    --json state,mergedAt,baseRefName,headRefName,url \
    --jq '[.state, (.mergedAt // "-"), .baseRefName, .headRefName, .url] | join("\u001f")'
}

set_pr_metadata() {
  local metadata
  metadata="$(read_pr_metadata)"
  IFS=$'\037' read -r state merged_at base_ref head_ref canonical_url <<<"$metadata"
  if [ "$merged_at" = "-" ]; then
    merged_at=""
  fi
}

read_terminal_required_check() {
  local checks_status
  local terminal_check

  set +e
  terminal_check="$(
    gh pr checks "$pr_url" \
      --required \
      --json name,state,bucket,workflow,description,link \
      --jq 'map(select(.bucket == "fail" or .bucket == "cancel"))[0] // empty | [(.name // ""), (.state // ""), (.bucket // ""), (.workflow // ""), (.description // ""), (.link // "")] | join("\u001f")'
  )"
  checks_status="$?"
  set -e

  if [ -n "$terminal_check" ]; then
    echo "$terminal_check"
    return 0
  fi

  if [ "$checks_status" -ne 0 ] && [ "$checks_status" -ne 8 ]; then
    echo "Unable to read required PR checks for $canonical_url; gh exited with status $checks_status." >&2
    return 2
  fi

  return 1
}

is_primary_checkout() {
  local git_common_dir
  local git_dir

  git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"
  git_dir="$(git rev-parse --absolute-git-dir)"

  [ "$git_common_dir" = "$git_dir" ]
}

sync_post_merge_checkout() {
  local base_ref="$1"

  if is_primary_checkout; then
    echo "Primary checkout detected; switching to $base_ref and fast-forwarding from origin/$base_ref."
    git switch "$base_ref"
    git pull --ff-only origin "$base_ref"
  else
    echo "Linked worktree detected; switching to detached origin/$base_ref."
    git switch --detach "origin/$base_ref"
  fi
}

print_plan() {
  local state="$1"
  local merged_at="$2"
  local base_ref="$3"
  local head_ref="$4"
  local canonical_url="$5"

  echo "PR: $canonical_url"
  echo "State: $state"
  echo "Merged at: ${merged_at:-<not merged>}"
  echo "Base: $base_ref"
  echo "Head: $head_ref"
  echo "Local branch: $branch"

  if [ "$state" = "MERGED" ]; then
    if is_primary_checkout; then
      echo "Dry run: would fetch/prune origin, require a clean tree, switch to local $base_ref, fast-forward it from origin/$base_ref, then delete $branch with git branch -d."
    else
      echo "Dry run: would fetch/prune origin, require a clean tree, switch to detached origin/$base_ref, then delete $branch with git branch -d."
    fi
  elif [ "$state" = "CLOSED" ]; then
    echo "Dry run: PR is closed without a merge; cleanup would stop without changing Git state."
  else
    echo "Dry run: PR is not merged yet; cleanup would watch required checks, stop on terminal required-check failure, and wait before changing Git state."
  fi
}

set_pr_metadata

if [ "$dry_run" -eq 1 ]; then
  print_plan "$state" "$merged_at" "$base_ref" "$head_ref" "$canonical_url"
  exit 0
fi

deadline=$(( $(date +%s) + timeout_seconds ))

while [ "$state" != "MERGED" ]; do
  failed_check=""

  if [ "$state" = "CLOSED" ]; then
    echo "PR closed without merging: $canonical_url" >&2
    exit 1
  fi

  set +e
  failed_check="$(read_terminal_required_check)"
  failed_check_status="$?"
  set -e

  if [ "$failed_check_status" -eq 0 ]; then
    IFS=$'\037' read -r failed_check_name failed_check_state failed_check_bucket failed_check_workflow failed_check_description failed_check_link <<<"$failed_check"
    echo "Required PR check reached terminal ${failed_check_bucket} state before merge: $failed_check_name" >&2
    echo "PR: $canonical_url" >&2
    echo "Check state: $failed_check_state" >&2
    echo "Workflow: ${failed_check_workflow:-<none>}" >&2
    echo "Details: ${failed_check_link:-<none>}" >&2
    if [ -n "$failed_check_description" ]; then
      echo "Description: $failed_check_description" >&2
    fi
    echo "Auto-merge RCA required before rerun: inspect the failed run/job logs, identify the failing test or command, cite log evidence, separate facts from inferences, recommend a fix, and state what was verified or remains unverified." >&2
    exit 1
  elif [ "$failed_check_status" -ne 1 ]; then
    exit 1
  fi

  now="$(date +%s)"
  if [ "$now" -ge "$deadline" ]; then
    echo "Timed out waiting for PR to merge after ${timeout_seconds}s: $canonical_url" >&2
    exit 1
  fi

  echo "Waiting for PR merge: $canonical_url (state: $state)"
  sleep "$poll_interval_seconds"

  set_pr_metadata
done

echo "PR merged at $merged_at: $canonical_url"

git fetch --prune origin

dirty_status="$(git status --short)"
if [ -n "$dirty_status" ]; then
  echo "Checkout is dirty; leaving branch untouched:" >&2
  echo "$dirty_status" >&2
  exit 1
fi

if ! git rev-parse --verify --quiet "refs/remotes/origin/$base_ref^{commit}" >/dev/null; then
  echo "Fetched base ref is unavailable: origin/$base_ref" >&2
  exit 1
fi

sync_post_merge_checkout "$base_ref"

if git show-ref --verify --quiet "refs/heads/$branch"; then
  if ! git branch -d -- "$branch"; then
    echo "Local branch is not fully merged; stopping cleanup: $branch" >&2
    exit 1
  fi
else
  echo "Local branch is already gone: $branch"
fi
