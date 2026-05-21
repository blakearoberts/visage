#!/usr/bin/env bash
set -euo pipefail

base_branch="${PROMOTE_CODEX_BASE_BRANCH:-main}"
staging_branch="${PROMOTE_CODEX_BRANCH:-codex}"
ci_workflow_name="${PROMOTE_CODEX_WORKFLOW:-CI}"
pr_title=""
pr_body=""
ignore_staged=false
ignore_unstaged=false
tmp_body_file=""

usage() {
  cat <<'USAGE'
Usage: npm run promote:codex -- --pr-title "PR title" --pr-body "PR body" [options]

Pushes codex, opens or updates a pull request from codex into main, waits for
auto-merge and required PR checks, waits for the main CI run on the merge
commit, fast-forwards local codex to main, then watches the downstream publish
workflow on the merge commit. The remote codex PR branch may be auto-deleted
by GitHub after merge.

Options:
  --pr-title         Required pull request title.
  --pr-body          Required pull request body. Literal \n sequences are
                     converted to real line breaks.
  --ignore-staged    Continue even when staged changes are present.
  --ignore-unstaged  Continue even when unstaged or untracked changes are present.
  -h, --help         Show this help.
USAGE
}

die() {
  echo "promote-codex: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

normalize_pr_body() {
  pr_body="${pr_body//\\n/$'\n'}"
}

current_branch() {
  git branch --show-current
}

cleanup() {
  [[ -z "$tmp_body_file" ]] || rm -f "$tmp_body_file"

  if [[ "$(current_branch 2>/dev/null || true)" != "$staging_branch" ]]; then
    git checkout "$staging_branch" >/dev/null 2>&1 || true
  fi
}

find_run_id() {
  local workflow_name="$1"
  local branch="$2"
  local sha="$3"

  ghx run list \
    --branch "$branch" \
    --limit 20 \
    --json databaseId,headSha,workflowName \
    --jq ".[] | select(.headSha == \"$sha\" and .workflowName == \"$workflow_name\") | .databaseId" |
    head -n 1
}

wait_for_run() {
  local workflow_name="$1"
  local branch="$2"
  local sha="$3"
  local run_id=""
  local conclusion=""
  local head_sha=""
  local run_url=""

  for _ in {1..60}; do
    run_id="$(find_run_id "$workflow_name" "$branch" "$sha")"
    if [[ -n "$run_id" ]]; then
      break
    fi
    sleep 2
  done

  [[ -n "$run_id" ]] ||
    die "could not find $workflow_name run for $branch at $sha"

  echo "Watching $workflow_name run $run_id for $branch at $sha"

  if ! ghx run watch "$run_id" --exit-status; then
    conclusion="$(ghx run view "$run_id" --json conclusion --jq .conclusion)"
    run_url="$(ghx run view "$run_id" --json url --jq .url)"
    die "$workflow_name run $run_id concluded with $conclusion: $run_url"
  fi

  conclusion="$(ghx run view "$run_id" --json conclusion --jq .conclusion)"
  head_sha="$(ghx run view "$run_id" --json headSha --jq .headSha)"
  [[ "$head_sha" == "$sha" ]] ||
    die "$workflow_name run $run_id used $head_sha, expected $sha"
  [[ "$conclusion" == "success" ]] ||
    die "$workflow_name run $run_id concluded with $conclusion"
}

wait_for_publish_workflow() {
  local branch="$1"
  local sha="$2"

  wait_for_run "Publish" "$branch" "$sha"
}

wait_for_required_checks() {
  local pr_number="$1"
  local checks_count=""
  local pending=""
  local failed=""

  for _ in {1..60}; do
    checks_count="$(
      ghx pr checks "$pr_number" \
        --required \
        --json event,name \
        --jq '[.[] | select(.event == "pull_request")] | length' 2>/dev/null || true
    )"
    if [[ "$checks_count" =~ ^[0-9]+$ ]] && ((checks_count > 0)); then
      break
    fi
    sleep 2
  done

  if ! [[ "$checks_count" =~ ^[0-9]+$ ]] || ((checks_count == 0)); then
    die "could not find required checks for PR #$pr_number"
  fi

  while true; do
    failed="$(
      ghx pr checks "$pr_number" \
        --required \
        --json bucket,event,link,name,state \
        --jq '.[] | select(.event == "pull_request" and (.bucket == "fail" or .bucket == "cancel")) | "\(.name): \(.state) \(.link)"'
    )"
    [[ -z "$failed" ]] ||
      die "required checks did not pass for PR #$pr_number: $failed"

    pending="$(
      ghx pr checks "$pr_number" \
        --required \
        --json bucket,event,name \
        --jq '.[] | select(.event == "pull_request" and .bucket == "pending") | .name'
    )"
    [[ -n "$pending" ]] || break

    echo "Waiting for required PR checks: $pending"
    sleep 10
  done
}

upsert_pull_request() {
  local title="$1"
  local body="$2"
  local pr_number=""

  tmp_body_file="$(mktemp)"
  printf '%s\n' "$body" >"$tmp_body_file"

  pr_number="$(
    ghx pr list \
      --state open \
      --head "$staging_branch" \
      --base "$base_branch" \
      --json number \
      --jq '.[0].number // empty'
  )"

  if [[ -n "$pr_number" ]]; then
    ghx pr edit "$pr_number" \
      --title "$title" \
      --body-file "$tmp_body_file" >/dev/null
  else
    local pr_url
    pr_url="$(
      ghx pr create \
        --base "$base_branch" \
        --head "$staging_branch" \
        --title "$title" \
        --body-file "$tmp_body_file"
    )"
    pr_number="$(ghx pr view "$pr_url" --json number --jq .number)"
  fi

  echo "$pr_number"
}

wait_for_auto_merge_enabled() {
  local pr_number="$1"
  local auto_merge_enabled=""
  local merge_sha=""
  local state=""

  for _ in {1..30}; do
    IFS=$'\037' read -r state auto_merge_enabled merge_sha <<<"$(
      ghx pr view "$pr_number" \
        --json autoMergeRequest,mergeCommit,state \
        --jq '[.state, ((.autoMergeRequest != null) | tostring), (.mergeCommit.oid // "")] | join("\u001f")'
    )"

    if [[ "$state" == "MERGED" && -n "$merge_sha" ]]; then
      return 0
    fi
    if [[ "$auto_merge_enabled" == "true" ]]; then
      return 0
    fi

    echo "Waiting for auto-merge to be enabled for PR #$pr_number"
    sleep 2
  done

  die "auto-merge was not enabled for PR #$pr_number"
}

wait_for_auto_merge() {
  local pr_number="$1"
  local expected_head="$2"
  local head_ref_oid=""
  local merge_sha=""
  local state=""

  for _ in {1..120}; do
    IFS=$'\037' read -r state merge_sha head_ref_oid <<<"$(
      ghx pr view "$pr_number" \
        --json headRefOid,mergeCommit,state \
        --jq '[.state, (.mergeCommit.oid // ""), .headRefOid] | join("\u001f")'
    )"

    if [[ -n "$head_ref_oid" && "$head_ref_oid" != "$expected_head" ]]; then
      die "PR #$pr_number head changed to $head_ref_oid, expected $expected_head"
    fi

    if [[ "$state" == "MERGED" && -n "$merge_sha" ]]; then
      echo "$merge_sha"
      return 0
    fi
    if [[ "$state" == "CLOSED" ]]; then
      die "PR #$pr_number was closed without merging"
    fi

    echo "Waiting for auto-merge to merge PR #$pr_number" >&2
    sleep 5
  done

  die "auto-merge did not merge PR #$pr_number"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr-title)
      [[ $# -ge 2 ]] || die "$1 requires a value"
      pr_title="$2"
      shift 2
      ;;
    --pr-title=*)
      pr_title="${1#*=}"
      shift
      ;;
    --pr-body)
      [[ $# -ge 2 ]] || die "$1 requires a value"
      pr_body="$2"
      shift 2
      ;;
    --pr-body=*)
      pr_body="${1#*=}"
      shift
      ;;
    --ignore-staged)
      ignore_staged=true
      shift
      ;;
    --ignore-unstaged)
      ignore_unstaged=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
done

normalize_pr_body

[[ -n "${pr_title//[[:space:]]/}" ]] ||
  die "--pr-title is required"
[[ -n "${pr_body//[[:space:]]/}" ]] ||
  die "--pr-body is required"

require_command git
require_command ghx

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

[[ "$(current_branch)" == "$staging_branch" ]] ||
  die "run this from the local $staging_branch branch"

trap cleanup EXIT

staged_paths="$(git diff --cached --name-only)"
if [[ -n "$staged_paths" && "$ignore_staged" != true ]]; then
  die "staged changes are present; commit or unstage them before promotion, or rerun with --ignore-staged: $staged_paths"
fi

unstaged_paths="$(
  {
    git diff --name-only
    git ls-files --others --exclude-standard
  } | sort -u
)"
if [[ -n "$unstaged_paths" && "$ignore_unstaged" != true ]]; then
  die "unstaged or untracked changes are present; commit, stash, or remove them before promotion, or rerun with --ignore-unstaged: $unstaged_paths"
fi

ghx auth status >/dev/null

repo="$(ghx repo view --json nameWithOwner --jq .nameWithOwner)"
can_push="$(ghx api "repos/$repo" --jq '.permissions.push')"
[[ "$can_push" == "true" ]] ||
  die "the active ghx account must have write access to $repo"

git fetch origin "$base_branch:refs/remotes/origin/$base_branch"
git merge-base --is-ancestor "origin/$base_branch" HEAD ||
  die "$staging_branch does not contain origin/$base_branch; update $staging_branch before promotion"

sha="$(git rev-parse HEAD)"
git push -u origin "$staging_branch"

pr_number="$(upsert_pull_request "$pr_title" "$pr_body")"
echo "Promote PR: #$pr_number"

wait_for_auto_merge_enabled "$pr_number"
wait_for_required_checks "$pr_number"

merge_sha="$(wait_for_auto_merge "$pr_number" "$sha")"

wait_for_run "$ci_workflow_name" "$base_branch" "$merge_sha"

git fetch --prune origin
git checkout "$staging_branch"
git merge --ff-only "origin/$base_branch"

if ! git rev-parse --verify --quiet "refs/remotes/origin/$staging_branch" >/dev/null; then
  git branch --unset-upstream "$staging_branch" >/dev/null 2>&1 || true
fi

wait_for_publish_workflow "$base_branch" "$merge_sha"
