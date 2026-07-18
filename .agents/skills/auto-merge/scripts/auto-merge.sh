#!/usr/bin/env bash
set -euo pipefail

pr_create_attempts=15
pr_create_poll_interval_seconds=2
timeout_seconds=900
poll_interval_seconds=15
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
  gh pr ready "$pr_url" > >(cat)
fi

gh pr merge --auto --merge "$pr_url" > >(cat)

pr_state="$(gh pr view "$pr_url" --json mergeStateStatus,baseRefName --jq '[.mergeStateStatus, .baseRefName] | join("\u001f")')"
IFS=$'\037' read -r merge_state_status base_branch <<<"$pr_state"

if [ "$merge_state_status" = "BEHIND" ]; then
  git fetch origin "$base_branch"
  if ! git rebase FETCH_HEAD; then
    git rebase --abort
    echo "Auto-merge is enabled, but the branch is out of date and could not be rebased cleanly onto $base_branch." >&2
    exit 1
  fi
  git push --force-with-lease
fi

read_pr_metadata() {
  gh pr view "$pr_url" \
    --json state,mergedAt,baseRefName,url \
    --jq '[.state, (.mergedAt // "-"), .baseRefName, .url] | join("\u001f")'
}

set_pr_metadata() {
  local metadata
  metadata="$(read_pr_metadata)"
  IFS=$'\037' read -r state merged_at base_ref canonical_url <<<"$metadata"
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

set_pr_metadata
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
