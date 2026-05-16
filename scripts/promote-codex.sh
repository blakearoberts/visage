#!/usr/bin/env bash
set -euo pipefail

base_branch="${PROMOTE_CODEX_BASE_BRANCH:-main}"
staging_branch="${PROMOTE_CODEX_BRANCH:-codex}"
workflow_name="${PROMOTE_CODEX_WORKFLOW:-CI}"
commit_message=""
tmp_body_file=""

usage() {
  cat <<'USAGE'
Usage: npm run promote:codex -- [-m "Commit message"]

Commits staged changes on codex, pushes codex, opens or updates a pull request
from codex into main, waits for required PR checks, merges the PR, waits for the
main CI run on the merge commit, then checks local codex back out.

Options:
  -m, --message  Commit staged changes with this message before promotion.
  -h, --help     Show this help.
USAGE
}

die() {
  echo "promote-codex: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
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
  local branch="$1"
  local sha="$2"

  gh run list \
    --branch "$branch" \
    --limit 20 \
    --json databaseId,headSha,workflowName \
    --jq ".[] | select(.headSha == \"$sha\" and .workflowName == \"$workflow_name\") | .databaseId" |
    head -n 1
}

wait_for_run() {
  local branch="$1"
  local sha="$2"
  local run_id=""

  for _ in {1..60}; do
    run_id="$(find_run_id "$branch" "$sha")"
    if [[ -n "$run_id" ]]; then
      break
    fi
    sleep 2
  done

  [[ -n "$run_id" ]] ||
    die "could not find $workflow_name run for $branch at $sha"

  gh run watch "$run_id" --exit-status

  local conclusion
  local head_sha
  conclusion="$(gh run view "$run_id" --json conclusion --jq .conclusion)"
  head_sha="$(gh run view "$run_id" --json headSha --jq .headSha)"
  [[ "$head_sha" == "$sha" ]] ||
    die "$workflow_name run $run_id used $head_sha, expected $sha"
  [[ "$conclusion" == "success" ]] ||
    die "$workflow_name run $run_id concluded with $conclusion"
}

wait_for_required_checks() {
  local pr_number="$1"
  local checks_count=""

  for _ in {1..60}; do
    checks_count="$(
      gh pr checks "$pr_number" \
        --required \
        --json name \
        --jq length 2>/dev/null || true
    )"
    if [[ "$checks_count" =~ ^[0-9]+$ ]] && ((checks_count > 0)); then
      break
    fi
    sleep 2
  done

  if ! [[ "$checks_count" =~ ^[0-9]+$ ]] || ((checks_count == 0)); then
    die "could not find required checks for PR #$pr_number"
  fi

  gh pr checks "$pr_number" --required --watch --fail-fast

  local unresolved
  unresolved="$(
    gh pr checks "$pr_number" \
      --required \
      --json name,bucket,state,link \
      --jq '.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.name): \(.state) \(.link)"'
  )"
  [[ -z "$unresolved" ]] ||
    die "required checks did not pass for PR #$pr_number: $unresolved"
}

upsert_pull_request() {
  local sha="$1"
  local pr_number=""

  tmp_body_file="$(mktemp)"
  cat >"$tmp_body_file" <<EOF
Promotes \`$staging_branch\` to \`$base_branch\`.

Head commit: \`$sha\`
EOF

  pr_number="$(
    gh pr list \
      --state open \
      --head "$staging_branch" \
      --base "$base_branch" \
      --json number \
      --jq '.[0].number // empty'
  )"

  if [[ -n "$pr_number" ]]; then
    gh pr edit "$pr_number" \
      --title "Promote $staging_branch to $base_branch" \
      --body-file "$tmp_body_file" >/dev/null
  else
    local pr_url
    pr_url="$(
      gh pr create \
        --base "$base_branch" \
        --head "$staging_branch" \
        --title "Promote $staging_branch to $base_branch" \
        --body-file "$tmp_body_file"
    )"
    pr_number="$(gh pr view "$pr_url" --json number --jq .number)"
  fi

  echo "$pr_number"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m | --message)
      [[ $# -ge 2 ]] || die "$1 requires a value"
      commit_message="$2"
      shift 2
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

require_command git
require_command gh

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

[[ "$(current_branch)" == "$staging_branch" ]] ||
  die "run this from the local $staging_branch branch"

trap cleanup EXIT

gh auth status >/dev/null

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
can_push="$(gh api "repos/$repo" --jq '.permissions.push')"
[[ "$can_push" == "true" ]] ||
  die "the active gh account must have write access to $repo"

if ! git diff --cached --quiet; then
  [[ -n "$commit_message" ]] ||
    die "staged changes require -m/--message"

  overlap="$(
    git diff --cached --name-only | while IFS= read -r path; do
      if ! git diff --quiet -- "$path"; then
        printf '%s\n' "$path"
      fi
    done
  )"
  [[ -z "$overlap" ]] ||
    die "staged paths also have unstaged edits; finish these first: $overlap"

  git commit -m "$commit_message"
elif [[ -n "$commit_message" ]]; then
  die "no staged changes to commit"
fi

[[ -z "$(git status --porcelain --untracked-files=all)" ]] ||
  die "working tree is dirty; commit or move changes aside before promotion"

git fetch origin "$base_branch:refs/remotes/origin/$base_branch"
git merge-base --is-ancestor "origin/$base_branch" HEAD ||
  die "$staging_branch does not contain origin/$base_branch; update $staging_branch before promotion"

sha="$(git rev-parse HEAD)"
git push -u origin "$staging_branch"

pr_number="$(upsert_pull_request "$sha")"
echo "Promote PR: #$pr_number"

wait_for_required_checks "$pr_number"

git fetch origin "$base_branch:refs/remotes/origin/$base_branch"
git merge-base --is-ancestor "origin/$base_branch" "$sha" ||
  die "$base_branch moved while checks were running; update $staging_branch before promotion"

gh pr merge "$pr_number" \
  --merge \
  --match-head-commit "$sha" \
  --subject "Promote $staging_branch to $base_branch" \
  --body "Promoted $staging_branch commit $sha."

merge_sha=""
for _ in {1..30}; do
  merge_sha="$(
    gh pr view "$pr_number" \
      --json mergeCommit \
      --jq '.mergeCommit.oid // empty'
  )"
  if [[ -n "$merge_sha" ]]; then
    break
  fi
  sleep 2
done

[[ -n "$merge_sha" ]] ||
  die "could not resolve merge commit for PR #$pr_number"

wait_for_run "$base_branch" "$merge_sha"

git fetch --prune origin
git checkout "$staging_branch"
